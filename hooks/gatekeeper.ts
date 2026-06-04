#!/usr/bin/env tsx
/**
 * PreToolUse / PermissionRequest hook — 静的ガードのみ。LLM 判定は /gatekeeper スキルに委譲。
 *
 * 判定フロー:
 *   0.   denied_patterns（ALWAYS_DENY）→ 即ブロック
 *   0.1  git add/commit（安全）→ 即 allow
 *   0.2  per-project allow patterns → 即 allow
 *   0.3  debug/* ブランチ → 全操作を即 allow
 *   1.   readonly_tools.json に登録済み → 即 allow
 *   2.   リスクある Bash 操作（git push / curl 書き込み等）かつ /gatekeeper 未評価 → block
 *   2.1  同上かつ /gatekeeper 評価済み（30分以内） → allow
 *   3.   それ以外 → allow
 *
 * PermissionRequest イベントでも同じ判定ロジックを使い、ネイティブ確認ダイアログを抑制する。
 *
 * エラー時はフック自体の障害でユーザー操作を止めないよう exit 0 にフォールバックする。
 */

import { execFileSync, spawnSync } from "child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
} from "fs";
import { homedir } from "os";
import { isAbsolute, join } from "path";
import { readEvents } from "./event-log.ts";

const LOG_PATH = join(homedir(), ".claude", "gatekeeper-log.jsonl");
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const GATEKEEPER_TTL_MS = 30 * 60 * 1000; // 30分以内の /gatekeeper 呼び出しを有効とみなす

interface HookInput {
  hook_event_name?: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  session_id?: string;
  cwd?: string;
}

interface LogEntry {
  timestamp: string;
  session_id: string;
  tool: string;
  input_summary: string;
  decision: "allow" | "block" | "error";
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

// git push / curl 書き込み操作 — /gatekeeper による事前評価が必要なパターン
const RISKY_BASH_PATTERNS: ReadonlyArray<RegExp> = [
  /\bgit\s+push\b/,
  /\bcurl\b.*\s-X\s+(POST|PUT|DELETE|PATCH)\b/i,
  /\bcurl\b.*--request\s+(POST|PUT|DELETE|PATCH)\b/i,
  /\bcurl\b.*\s--data\b/i,
  /\bcurl\b.*\s-d\s/,
];

function isRiskyBashCommand(cmd: string): boolean {
  return RISKY_BASH_PATTERNS.some((p) => p.test(cmd));
}

function hasRecentGatekeeperCall(sessionId: string): boolean {
  if (!sessionId) return false;
  try {
    const events = readEvents(sessionId);
    const now = Date.now();
    return events.some(
      (e) =>
        e.kind === "skill_start" &&
        e.skill === "gatekeeper" &&
        now - new Date(e.ts).getTime() < GATEKEEPER_TTL_MS,
    );
  } catch {
    return false; // fail-open: ログ読み取り失敗時はブロックしない
  }
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

function allow(reason: string, eventName = "PreToolUse", additionalContext?: string): void {
  const hookOutput: Record<string, unknown> =
    eventName === "PermissionRequest"
      ? { hookEventName: "PermissionRequest", decision: { behavior: "allow" } }
      : { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: reason };
  if (additionalContext) hookOutput.additionalContext = additionalContext;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: hookOutput }) + "\n");
  process.exit(0);
}

function block(reason: string, eventName = "PreToolUse", additionalContext?: string): void {
  const hookOutput: Record<string, unknown> =
    eventName === "PermissionRequest"
      ? { hookEventName: "PermissionRequest", decision: { behavior: "deny" } }
      : { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason };
  if (additionalContext) hookOutput.additionalContext = additionalContext;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: hookOutput }) + "\n");
  process.exit(0);
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  const data: HookInput = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  const eventName = data.hook_event_name ?? "PreToolUse";
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
    block(deniedReason, eventName);
    return;
  }

  // 0.1. 安全な git ローカル操作 → 自動承認
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
      allow(reason, eventName);
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
      allow(reason, eventName);
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

  // 2. リスクある Bash 操作 — /gatekeeper 評価が必要
  if (toolName === "Bash" && isRiskyBashCommand(String(toolInput.command ?? ""))) {
    if (hasRecentGatekeeperCall(data.session_id ?? "")) {
      const reason = "/gatekeeper 評価済み（30分以内）→ 承認";
      writeLog({ ...baseLog, timestamp: new Date().toISOString().slice(0, 19), decision: "allow", reason, latency_ms: 0 });
      allow(reason, eventName);
    } else {
      const reason = `要 /gatekeeper 評価: ${summary.slice(0, 80)}`;
      writeLog({ ...baseLog, timestamp: new Date().toISOString().slice(0, 19), decision: "block", reason, latency_ms: 0 });
      block(reason, eventName, "/gatekeeper を起動して評価してから再実行してください");
    }
    return;
  }

  // 3. それ以外 → allow
  const reason = "静的ルール対象外 → 承認";
  writeLog({
    ...baseLog,
    timestamp: new Date().toISOString().slice(0, 19),
    decision: "allow",
    reason,
    latency_ms: 0,
  });
  allow(reason, eventName);
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
  allow(`gatekeeper error (fail-open): ${err.message}`, "PreToolUse");
});
