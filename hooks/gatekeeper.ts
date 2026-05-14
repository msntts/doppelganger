#!/usr/bin/env tsx
/**
 * PreToolUse hook — 危険度判定と承認フロー
 *
 * 判定フロー:
 *   0.   denied_patterns（ALWAYS_DENY）→ 即ブロック
 *   0.1  git add/commit（安全）→ 即 allow
 *   0.2  per-project allow patterns → 即 allow
 *   0.3  debug/* ブランチ → 全操作を即 allow
 *   1.   readonly_tools.json に登録済み → 即 allow
 *   2.   LLM 分類（category のみ返す。allow/ask/block の決定は TypeScript が行う）
 *   3.   per-project category_overrides.json → カテゴリ単位の決定上書き
 *   4.   GLOBAL_DECISION マップ → 最終判定
 *
 * エラー時はフック自体の障害でユーザー操作を止めないよう exit 0 にフォールバックする。
 */

import { execFileSync, spawnSync } from "child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
} from "fs";
import { homedir } from "os";
import { isAbsolute, join } from "path";

const LOG_PATH = join(homedir(), ".claude", "gatekeeper-log.jsonl");
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10MB

const SYSTEM_PROMPT = `\
あなたは Claude Code のツール呼び出しを **分類するだけ** のアナライザーです。
allow/ask/block の判断は行いません。以下の固定カテゴリのいずれかに分類してください。

## 分類の基本哲学

**外部・共有リソースへのアクセスは「書き込む（変更する）かどうか」で判断する。**
読み取るだけなら readonly に分類する。git fetch/pull のようにリモートから取得する操作も
共有リモートを書き換えないため readonly に分類する。

## カテゴリ定義

| category | 該当する操作の例 |
|---|---|
| readonly | ファイル読み取り（cat/grep/find）、git status/log/diff、ls/ps/env、curl GET、Web 取得、git fetch、git pull（共有リモートを書き換えない取得操作） |
| git_local | git add、git commit（--amend なし）|
| git_remote | git push（force なし）— リモートリポジトリに書き込む操作のみ |
| external_write | 外部 API への書き込み（POST/PUT/DELETE）、clasp push/deploy、S3 upload など |
| system_write | ~/.ssh/・~/.aws/・/etc/ など git 管理外への書き込み |
| destructive | rm -rf、DROP TABLE/DATABASE、git push --force、git reset --hard |
| uncertain | 上記に当てはまらない、または判断に必要な情報が不足している |

## 判定手順

1. このツール呼び出しが実際に何をするかを把握する
2. **外部リソースにアクセスする場合は「書き込むか読み取るか」を先に判断し、読み取りなら readonly を選ぶ**
3. 上記カテゴリ表のどれに最も近いかを選ぶ
4. 迷ったら uncertain にする（allow/ask/block を直接判断しようとしない）

## 出力形式

必ず以下の JSON のみを返すこと。説明文・前置き・コードブロックは不要。

{"category": "readonly", "interpretation": "操作の意味（日本語一文）"}
{"category": "external_write", "interpretation": "操作の意味（日本語一文）", "reason": "ask 時にユーザーへ表示するメッセージ（省略可）"}\
`;

// カテゴリ定義
type Category =
  | "readonly"
  | "git_local"
  | "git_remote"
  | "external_write"
  | "system_write"
  | "destructive"
  | "uncertain";

const VALID_CATEGORIES = new Set<string>([
  "readonly",
  "git_local",
  "git_remote",
  "external_write",
  "system_write",
  "destructive",
  "uncertain",
]);

// カテゴリ → デフォルト判定マップ
const GLOBAL_DECISION: Record<Category, "allow" | "ask" | "block"> = {
  readonly: "allow",
  git_local: "allow",
  git_remote: "ask",
  external_write: "ask",
  system_write: "ask",
  destructive: "block",
  uncertain: "ask",
};

interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  session_id?: string;
  cwd?: string;
}

interface Judgment {
  category: Category;
  interpretation?: string;
  reason?: string;
}

interface LogEntry {
  timestamp: string;
  session_id: string;
  tool: string;
  input_summary: string;
  interpretation?: string;
  decision: "allow" | "ask" | "block" | "error";
  reason?: string;
  latency_ms: number;
}

interface DeniedPatterns {
  tools: string[];
  bash_patterns: string[];
}

function inputSummary(
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  if (toolName === "Bash") return String(toolInput.command ?? "").slice(0, 200);
  if (
    toolName === "Write" ||
    toolName === "Edit" ||
    toolName === "NotebookEdit"
  ) {
    return String(toolInput.file_path ?? "");
  }
  return JSON.stringify(toolInput).slice(0, 200);
}

function writeLog(entry: LogEntry): void {
  try {
    if (existsSync(LOG_PATH) && statSync(LOG_PATH).size >= LOG_MAX_BYTES) {
      renameSync(LOG_PATH, LOG_PATH + ".1");
    }
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // ログ失敗はサイレントに無視
  }
}

function currentBranch(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function projectClaudeDir(cwd?: string): string | null {
  if (!cwd || !isAbsolute(cwd)) return null;
  try {
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      cwd,
      timeout: 5000,
    });
    if (result.status !== 0) return null;
    return join(result.stdout.trim(), ".claude");
  } catch {
    return null;
  }
}

function loadDeniedPatterns(cwd?: string): DeniedPatterns {
  const globalPath = join(
    import.meta.dirname ?? __dirname,
    "denied_patterns.json",
  );
  let data: DeniedPatterns = { tools: [], bash_patterns: [] };
  try {
    data = JSON.parse(readFileSync(globalPath, "utf-8")) as DeniedPatterns;
  } catch {
    // グローバルファイルがなければ空で続行
  }

  const claudeDir = projectClaudeDir(cwd);
  if (claudeDir) {
    const localPath = join(claudeDir, "denied_patterns.json");
    try {
      const local = JSON.parse(
        readFileSync(localPath, "utf-8"),
      ) as DeniedPatterns;
      data.tools = [...new Set([...data.tools, ...(local.tools ?? [])])];
      data.bash_patterns = [
        ...new Set([...data.bash_patterns, ...(local.bash_patterns ?? [])]),
      ];
    } catch {
      // プロジェクトファイルがなければスキップ
    }
  }

  return data;
}

function isDenied(
  toolName: string,
  toolInput: Record<string, unknown>,
  patterns: DeniedPatterns,
): string | null {
  if (patterns.tools.includes(toolName)) {
    return `${toolName}: denied_patterns により常時ブロック`;
  }
  if (toolName === "Bash") {
    const command = String(toolInput.command ?? "");
    for (const pattern of patterns.bash_patterns) {
      if (command.includes(pattern)) {
        return `Bash: 禁止パターン '${pattern}' を含むためブロック`;
      }
    }
  }
  return null;
}

// 任意の入力で副作用を起こせるツールは learn 対象から永続的に除外する。
const NEVER_READONLY: ReadonlySet<string> = new Set([
  "Bash",
  "Edit",
  "Write",
  "NotebookEdit",
  "Agent",
  "Skill",
  "Monitor",
]);

// destructive 操作の git スコープチェック用ヘルパー

function gitRootForCwd(cwd?: string): string | null {
  if (!cwd) return null;
  const result = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
    timeout: 5000,
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

// rm/rmdir のみを対象とする。
// git reset --hard は unstaged 変更を消去しこれは reflog でも復元不可のため除外。
// git clean は未追跡ファイルを削除し git で復元不可のため除外。
function isFilesystemDestructive(command: string): boolean {
  return /\brm\s/.test(command) || /\brmdir\b/.test(command);
}

// コマンド中のパスが git root の外を指していないか確認する。
// 以下のいずれかに該当する場合は false（= auto-allow しない）:
//   - .. を含む（パストラバーサル）
//   - ~ を含む（ホームディレクトリ参照）
//   - $ を含む（シェル変数展開は静的解析不可）
//   - { を含む（ブレース展開）
//   - ` を含む（バッククォートによるコマンド置換）
//   - 絶対パスが git root 内の子パスでない（symlink は realpath で解決する）
function targetedPathsAreWithinRoot(command: string, gitRoot: string): boolean {
  if (/\.\./.test(command)) return false;
  if (/~/.test(command)) return false;
  if (/\$/.test(command)) return false;
  if (/\{/.test(command)) return false;
  if (/`/.test(command)) return false;

  const absolutePaths = command.match(/(?:^|[\s"'])(\/.+?)(?=[\s"';&|]|$)/g) ?? [];
  const outsidePaths = absolutePaths
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((p) => {
      if (!p.startsWith("/")) return false;
      if (/^\/dev\//.test(p)) return false;
      // symlink を解決して git root 外を指していないか確認する
      try {
        const real = realpathSync(p);
        return !real.startsWith(gitRoot + "/");
      } catch {
        // パスが存在しない場合は文字列比較にフォールバック
        return !p.startsWith(gitRoot + "/");
      }
    });
  return outsidePaths.length === 0;
}

function loadBashAllowPatterns(cwd?: string): string[] {
  const claudeDir = projectClaudeDir(cwd);
  if (!claudeDir) return [];
  try {
    const data = JSON.parse(
      readFileSync(join(claudeDir, "allow_patterns.json"), "utf-8"),
    ) as { bash?: unknown };
    if (!Array.isArray(data.bash)) return [];
    return data.bash.filter((p): p is string => typeof p === "string");
  } catch {
    return [];
  }
}

function loadReadonlyTools(cwd?: string): Set<string> {
  const claudeDir = projectClaudeDir(cwd);
  if (!claudeDir) return new Set();
  try {
    const data = JSON.parse(
      readFileSync(join(claudeDir, "readonly_tools.json"), "utf-8"),
    ) as { tools: string[] };
    return new Set((data.tools ?? []).filter((t) => !NEVER_READONLY.has(t)));
  } catch {
    return new Set();
  }
}

function loadProjectPolicy(cwd?: string): string | null {
  const claudeDir = projectClaudeDir(cwd);
  if (!claudeDir) return null;
  const target = join(claudeDir, "approval_policy.md");
  if (!existsSync(target)) return null;
  try {
    const resolved = realpathSync(target);
    if (!resolved.startsWith(realpathSync(claudeDir))) return null;
    return readFileSync(resolved, "utf-8").trim();
  } catch {
    return null;
  }
}

// destructive・system_write は allow に上書きできない（サプライチェーン経由の設定ファイル改ざんで
// 破壊操作が自動承認されるリスクを防ぐ）。ask への変更のみ許可。
const NEVER_OVERRIDE_TO_ALLOW: ReadonlySet<Category> = new Set([
  "destructive",
  "system_write",
]);

function loadCategoryOverrides(
  cwd?: string,
): Partial<Record<Category, "allow" | "ask" | "block">> {
  const claudeDir = projectClaudeDir(cwd);
  if (!claudeDir) return {};
  try {
    const raw = JSON.parse(
      readFileSync(join(claudeDir, "category_overrides.json"), "utf-8"),
    ) as Record<string, string>;
    const result: Partial<Record<Category, "allow" | "ask" | "block">> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (
        VALID_CATEGORIES.has(k) &&
        (v === "allow" || v === "ask" || v === "block")
      ) {
        const cat = k as Category;
        if (v === "allow" && NEVER_OVERRIDE_TO_ALLOW.has(cat)) continue;
        result[cat] = v;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function buildSystemPrompt(cwd?: string): string {
  const projectPolicy = loadProjectPolicy(cwd);
  if (!projectPolicy) return SYSTEM_PROMPT;
  return (
    SYSTEM_PROMPT +
    "\n\n## プロジェクト固有の分類ヒント（グローバルより優先）\n\n" +
    projectPolicy
  );
}

interface ClaudeJsonOutput {
  result: string;
  is_error?: boolean;
}

function extractJson(text: string): Judgment {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{.*\}/s);
    if (!match) throw new Error(`JSON not found in: ${text.slice(0, 200)}`);
    parsed = JSON.parse(match[0]);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `expected object, got ${typeof parsed} in: ${text.slice(0, 200)}`,
    );
  }
  const j = parsed as Record<string, unknown>;
  if (typeof j.category !== "string" || !VALID_CATEGORIES.has(j.category)) {
    throw new Error(
      `invalid category "${j.category}" in: ${text.slice(0, 200)}`,
    );
  }
  return {
    category: j.category as Category,
    interpretation:
      typeof j.interpretation === "string" ? j.interpretation : undefined,
    reason: typeof j.reason === "string" ? j.reason : undefined,
  };
}

function judge(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd?: string,
): Judgment {
  const userMessage = JSON.stringify(
    { tool: toolName, input: toolInput },
    null,
    2,
  );
  const systemPrompt = buildSystemPrompt(cwd);

  const result = spawnSync(
    "claude",
    [
      "-p",
      "--no-session-persistence",
      "--model",
      "claude-haiku-4-5-20251001",
      "--output-format",
      "json",
      "--system-prompt",
      systemPrompt,
      userMessage,
    ],
    { encoding: "utf-8", timeout: 30000 },
  );

  if (result.error)
    throw new Error(`subprocess error: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`claude exited with ${result.status}: ${result.stderr}`);

  const envelope = JSON.parse(result.stdout.trim()) as ClaudeJsonOutput;
  if (envelope.is_error)
    throw new Error(`claude returned error: ${envelope.result}`);
  return extractJson(envelope.result);
}

function allow(reason: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: reason,
      },
    }) + "\n",
  );
  process.exit(0);
}

function block(reason: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }) + "\n",
  );
  process.exit(0);
}

function ask(reason: string): void {
  process.stderr.write(`[gatekeeper] ⚠️ ${reason}\n`);
  process.exit(0);
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  const data: HookInput = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  const toolName = data.tool_name;
  const toolInput = data.tool_input ?? {};
  const summary = inputSummary(toolName, toolInput);
  const baseLog = {
    session_id: data.session_id ?? "",
    tool: toolName,
    input_summary: summary,
  };

  // 0. ALWAYS_DENY
  const deniedReason = isDenied(
    toolName,
    toolInput,
    loadDeniedPatterns(data.cwd),
  );
  if (deniedReason) {
    writeLog({
      ...baseLog,
      timestamp: new Date().toISOString().slice(0, 19),
      decision: "block",
      reason: deniedReason,
      latency_ms: 0,
    });
    block(deniedReason);
    return;
  }

  // 0.1. 安全な git ローカル操作 → 自動承認
  //   CLAUDE.md のワークフロールール（「コミット前に /review を呼べ」等）の遵守確認は
  //   gatekeeper の役割外。LLM judge に委ねると CLAUDE.md 知識を適用して ask を返すため
  //   コード側で確定的に承認する。
  if (toolName === "Bash") {
    const cmd = String(toolInput.command ?? "");
    if (
      /\bgit\s+(add|commit)\b/.test(cmd) &&
      !/--no-verify\b|--amend\b/.test(cmd)
    ) {
      const reason = "git add/commit (ローカル・--no-verify なし) → 自動承認";
      writeLog({
        ...baseLog,
        timestamp: new Date().toISOString().slice(0, 19),
        decision: "allow",
        reason,
        latency_ms: 0,
      });
      allow(reason);
      return;
    }
  }

  // 0.2. per-project Bash allow patterns（特定コマンドの静的 allow）
  if (toolName === "Bash") {
    const cmd = String(toolInput.command ?? "");
    const bashPatterns = loadBashAllowPatterns(data.cwd);
    const matchedPattern = bashPatterns.find((p) => {
      const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[;&|\\s])${escaped}(\\s|$)`).test(cmd);
    });
    if (matchedPattern) {
      const reason = `allow_patterns match: "${matchedPattern}" → 自動承認`;
      writeLog({
        ...baseLog,
        timestamp: new Date().toISOString().slice(0, 19),
        decision: "allow",
        reason,
        latency_ms: 0,
      });
      allow(reason);
      return;
    }
  }

  // 0.3. debug/* ブランチ: 全操作を自動承認
  const branch = currentBranch();
  if (branch?.startsWith("debug/")) {
    const reason = `debug/* ブランチのため自動承認 (branch: ${branch})`;
    writeLog({
      ...baseLog,
      timestamp: new Date().toISOString().slice(0, 19),
      decision: "allow",
      reason,
      latency_ms: 0,
    });
    allow(reason);
    return;
  }

  // 1. readonly_tools（ツール名単位の静的 allow リスト）
  if (loadReadonlyTools(data.cwd).has(toolName)) {
    const reason = `${toolName}: readonly_tools に登録済みのため自動承認`;
    writeLog({
      ...baseLog,
      timestamp: new Date().toISOString().slice(0, 19),
      decision: "allow",
      reason,
      latency_ms: 0,
    });
    allow(reason);
    return;
  }

  // 2. LLM 分類（category のみ返す）
  const start = Date.now();
  const judgment = judge(toolName, toolInput, data.cwd);
  const latency_ms = Date.now() - start;

  // 3. per-project category_overrides → 4. GLOBAL_DECISION の順で判定
  const overrides = loadCategoryOverrides(data.cwd);
  const overrideDecision = overrides[judgment.category];
  let decision = overrideDecision ?? GLOBAL_DECISION[judgment.category];

  // Post-processing: git 管理下のファイルシステム破壊操作は allow に昇格
  // 「git 管理下であれば元に戻せる」という哲学に基づく。
  // git push --force や DROP TABLE 等の非 filesystem 操作は対象外とする。
  let gitScopeOverride = false;
  if (decision === "block" && judgment.category === "destructive" && toolName === "Bash") {
    const cmd = String(toolInput.command ?? "");
    const gitRoot = gitRootForCwd(data.cwd);
    if (gitRoot && isFilesystemDestructive(cmd) && targetedPathsAreWithinRoot(cmd, gitRoot)) {
      decision = "allow";
      gitScopeOverride = true;
    }
  }

  const defaultReason: Record<Category, string> = {
    readonly: "read-only 操作",
    git_local: "ローカル git 操作",
    git_remote: "リモートリポジトリへの書き込みのため確認が必要です",
    external_write: "外部サービスへの書き込みのため確認が必要です",
    system_write: "git 管理外への書き込みのため確認が必要です",
    destructive: "不可逆な破壊操作のためブロックします",
    uncertain: "操作の影響を確認できないため確認が必要です",
  };

  const baseReason = gitScopeOverride
    ? "git管理下のファイルシステム操作 → 復元可能のため自動承認"
    : (judgment.reason ?? defaultReason[judgment.category]);
  const effectiveReason = overrideDecision && !gitScopeOverride
    ? `[category_overrides: ${judgment.category} → ${overrideDecision}] ${baseReason}`
    : baseReason;

  const logEntry: LogEntry = {
    ...baseLog,
    timestamp: new Date().toISOString().slice(0, 19),
    interpretation: judgment.interpretation,
    decision,
    reason: effectiveReason,
    latency_ms,
  };

  writeLog(logEntry);

  if (decision === "allow") {
    allow(gitScopeOverride ? baseReason : (judgment.interpretation ?? defaultReason[judgment.category]));
  } else if (decision === "block") {
    block(effectiveReason);
  } else {
    ask(effectiveReason);
  }
}

main().catch((err: Error) => {
  writeLog({
    timestamp: new Date().toISOString().slice(0, 19),
    session_id: "",
    tool: "unknown",
    input_summary: "",
    decision: "error",
    reason: err.message,
    latency_ms: 0,
  });
  process.stderr.write(`[gatekeeper] error: ${err.message}\n`);
  // フック自体の障害でユーザー操作を止めないよう明示的に allow してフォールバック
  allow(`gatekeeper error (fail-open): ${err.message}`);
});
