#!/usr/bin/env tsx
/**
 * PreToolUse hook — 危険度判定と承認フロー
 *
 * 判定フロー:
 *   0. denied_patterns（ALWAYS_DENY）→ 即ブロック
 *   0.5. debug/* ブランチ → 全操作を自動承認
 *   1. readonly_tools.json に登録済み → 即承認
 *   2. LLM 判定（approval_policy.md 基準）
 *      - learn: true のとき readonly_tools.json に永続化
 *
 * エラー時はフック自体の障害でユーザー操作を止めないよう exit 0 にフォールバックする。
 */

import { execFileSync, spawnSync } from "child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { isAbsolute, join } from "path";

const LOG_PATH = join(homedir(), ".claude", "gatekeeper-log.jsonl");
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10MB

const SYSTEM_PROMPT = `\
あなたは Claude Code のツール呼び出しの安全性を判定するゲートキーパーです。
ツール名と入力内容を受け取り、実行を許可するかどうかを判定します。

## 承認ポリシー

操作を評価するときは、以下の2軸で考える。

### 軸1: 副作用の有無（read-only か否か）
- **read-only**: ファイルやシステムの状態を変えない操作
- **write / destructive**: 状態を変える操作

### 軸2: 回復可能性（git管理下か否か）
- **回復可能**: git リポジトリ配下のファイルへの操作（untracked でも .git/ があれば対象）
- **回復困難**: git 管理外（~/.ssh/、~/.aws/、/etc/ 等）

### 自動承認してよい操作
- ファイルの読み取り（cat / head / tail / grep / find 等）
- git 読み取りコマンド（status / log / diff / show / branch 等）
- コマンド出力の確認（ls / ps / env / which / df / du 等）
- Web の取得（fetch / curl の GET 等）
- git 管理下プロジェクト配下のファイル編集・作成・削除
- git add / git commit（ローカル）/ git push（force なし）
- ~/.claude/ 配下の編集（settings.json を除く）
- テスト実行・ビルドコマンド
- プロジェクト内に閉じるパッケージインストール（グローバルフラグなし）

### 要確認（ask）操作
- git push --force / --force-with-lease
- プロジェクト外へのファイル書き込み（~/.ssh/、~/.aws/、/etc/ 等）
- ~/.claude/settings.json の編集
- グローバル・システムへのパッケージインストール（-g / --global / sudo / brew install 等）
- 外部サービスへの書き込み（API の POST / PUT / DELETE 等）
- プロセス管理（kill / pkill 等）
- cron の登録・削除
- 環境変数の永続化（.env 書き込み等）

### ブロック（block）操作
- git 管理外のファイル・ディレクトリの削除（バックアップなし）
- git push --force（--force-with-lease は ask）
- git reset --hard
- git commit --no-verify / git push --no-verify
- DROP TABLE / DROP DATABASE / TRUNCATE TABLE（特に prod 接続先）
- 本番環境への直接デプロイ（CI/CD 経由でない操作）

迷ったら ask。明らかに危険な操作のみ block。

## 判定手順
必ず以下の順序で思考してから出力すること。

1. **操作の解釈**: このツール呼び出しが実際に何をするのかを平易な日本語で述べる
2. **不可逆性の評価**: その操作は元に戻せるか。git 管理下か、対象範囲はどこか等を考慮する
3. **learn 判定**: このツール種別がどんな入力でも常に read-only であれば true（例: WebSearch → true / Edit・Write・Bash → false）
4. **判定**: approve / ask / block のいずれかを決定する

## 出力形式
必ず以下の JSON のみを返すこと。説明文・前置き・コードブロックは不要。

{"interpretation": "操作の意味を一文で（日本語）", "decision": "approve", "learn": false}
{"interpretation": "操作の意味を一文で（日本語）", "decision": "ask", "learn": false, "reason": "何を確認すべきか（日本語）"}
{"interpretation": "操作の意味を一文で（日本語）", "decision": "block", "learn": false, "reason": "何が危険か（日本語）"}\
`;

interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  session_id?: string;
  cwd?: string;
}

interface Judgment {
  interpretation?: string;
  decision: "approve" | "ask" | "block";
  learn?: boolean;
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

function inputSummary(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === "Bash") return String(toolInput.command ?? "").slice(0, 200);
  if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") {
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
  const globalPath = join(import.meta.dirname ?? __dirname, "denied_patterns.json");
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
      const local = JSON.parse(readFileSync(localPath, "utf-8")) as DeniedPatterns;
      data.tools = [...new Set([...data.tools, ...(local.tools ?? [])])];
      data.bash_patterns = [...new Set([...data.bash_patterns, ...(local.bash_patterns ?? [])])];
    } catch {
      // プロジェクトファイルがなければスキップ
    }
  }

  return data;
}

function isDenied(toolName: string, toolInput: Record<string, unknown>, patterns: DeniedPatterns): string | null {
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

function loadReadonlyTools(cwd?: string): Set<string> {
  const claudeDir = projectClaudeDir(cwd);
  if (!claudeDir) return new Set();
  try {
    const data = JSON.parse(readFileSync(join(claudeDir, "readonly_tools.json"), "utf-8")) as { tools: string[] };
    return new Set(data.tools ?? []);
  } catch {
    return new Set();
  }
}

function saveReadonlyTool(toolName: string, cwd?: string): void {
  const claudeDir = projectClaudeDir(cwd);
  if (!claudeDir) return;
  try {
    mkdirSync(claudeDir, { recursive: true });
    const path = join(claudeDir, "readonly_tools.json");
    let tools: Set<string> = new Set();
    try {
      const data = JSON.parse(readFileSync(path, "utf-8")) as { tools: string[] };
      tools = new Set(data.tools ?? []);
    } catch {
      // 新規作成
    }
    if (!tools.has(toolName)) {
      tools.add(toolName);
      writeFileSync(path, JSON.stringify({ tools: [...tools].sort() }, null, 2) + "\n", "utf-8");
    }
  } catch {
    // 保存失敗はサイレントに無視
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

function buildSystemPrompt(cwd?: string): string {
  const projectPolicy = loadProjectPolicy(cwd);
  if (!projectPolicy) return SYSTEM_PROMPT;
  return (
    SYSTEM_PROMPT +
    "\n\n## プロジェクト固有のルール（グローバルより優先）\n\n" +
    projectPolicy
  );
}

const JUDGMENT_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    interpretation: { type: "string" },
    decision: { type: "string", enum: ["approve", "ask", "block"] },
    learn: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["decision"],
});

interface ClaudeJsonOutput {
  result: string;
  is_error?: boolean;
}

function extractJson(text: string): Judgment {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
  try {
    return JSON.parse(cleaned) as Judgment;
  } catch {
    const match = cleaned.match(/\{.*\}/s);
    if (match) return JSON.parse(match[0]) as Judgment;
    throw new Error(`JSON not found in: ${text.slice(0, 200)}`);
  }
}

function judge(toolName: string, toolInput: Record<string, unknown>, cwd?: string): Judgment {
  const userMessage = JSON.stringify({ tool: toolName, input: toolInput }, null, 2);
  const systemPrompt = buildSystemPrompt(cwd);

  const result = spawnSync(
    "claude",
    [
      "-p",
      "--no-session-persistence",
      "--model", "claude-haiku-4-5-20251001",
      "--output-format", "json",
      "--json-schema", JUDGMENT_SCHEMA,
      "--system-prompt", systemPrompt,
      userMessage,
    ],
    { encoding: "utf-8", timeout: 30000 }
  );

  if (result.error) throw new Error(`subprocess error: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`claude exited with ${result.status}: ${result.stderr}`);

  const envelope = JSON.parse(result.stdout.trim()) as ClaudeJsonOutput;
  if (envelope.is_error) throw new Error(`claude returned error: ${envelope.result}`);
  return extractJson(envelope.result);
}

function allow(reason: string): void {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: reason,
    },
  }) + "\n");
  process.exit(0);
}

function block(reason: string): void {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }) + "\n");
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
  const baseLog = { session_id: data.session_id ?? "", tool: toolName, input_summary: summary };

  // 0. ALWAYS_DENY
  const deniedReason = isDenied(toolName, toolInput, loadDeniedPatterns(data.cwd));
  if (deniedReason) {
    writeLog({ ...baseLog, timestamp: new Date().toISOString().slice(0, 19), decision: "block", reason: deniedReason, latency_ms: 0 });
    block(deniedReason);
    return;
  }

  // 0.5. debug/* ブランチ: 全操作を自動承認
  const branch = currentBranch();
  if (branch?.startsWith("debug/")) {
    const reason = `debug/* ブランチのため自動承認 (branch: ${branch})`;
    writeLog({ ...baseLog, timestamp: new Date().toISOString().slice(0, 19), decision: "allow", reason, latency_ms: 0 });
    allow(reason);
    return;
  }

  // 1. readonly_tools
  if (loadReadonlyTools(data.cwd).has(toolName)) {
    const reason = `${toolName}: readonly_tools に登録済みのため自動承認`;
    writeLog({ ...baseLog, timestamp: new Date().toISOString().slice(0, 19), decision: "allow", reason, latency_ms: 0 });
    allow(reason);
    return;
  }

  // 2. LLM 判定
  const start = Date.now();
  const result = judge(toolName, toolInput, data.cwd);
  const latency_ms = Date.now() - start;

  const logEntry: LogEntry = {
    ...baseLog,
    timestamp: new Date().toISOString().slice(0, 19),
    interpretation: result.interpretation,
    decision: result.decision === "approve" ? "allow" : result.decision,
    ...(result.reason ? { reason: result.reason } : {}),
    latency_ms,
  };

  if (result.decision === "approve") {
    if (result.learn) {
      saveReadonlyTool(toolName, data.cwd);
    }
    writeLog(logEntry);
    allow(result.interpretation ?? "gatekeeper approved");
  } else if (result.decision === "block") {
    writeLog(logEntry);
    block(result.reason ?? "危険な操作のためブロック");
  } else {
    writeLog(logEntry);
    ask(result.reason ?? "要確認の操作です");
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
  process.exit(0);
});
