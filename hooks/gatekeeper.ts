#!/usr/bin/env tsx
/**
 * PreToolUse / PermissionRequest hook — 静的ガードのみ。LLM 判定は /gatekeeper スキルに委譲。
 *
 * 判定フロー:
 *   0.   denied_patterns（ALWAYS_DENY）→ 即ブロック
 *   0.1  git add/commit（安全）→ 即 allow
 *   0.1.5 /gatekeeper スキル → event log に skill_start を記録して即 allow（自己ブロック防止）
 *   0.2  per-project allow patterns → 即 allow
 *   0.3  debug/* ブランチ → 全操作を即 allow
 *   1.   readonly_tools.json に登録済み → 即 allow
 *   2.   それ以外（PermissionRequest）→ allow（ネイティブダイアログ抑制）
 *   2.   それ以外（PreToolUse）→ 今回のユーザーターン内に /gatekeeper 評価済みなら allow、未評価なら deny
 *
 * PermissionRequest は常に allow を返してネイティブダイアログを抑制する。
 * PreToolUse で event log の skill_start(gatekeeper) を確認して実際の強制を行う。
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
import { appendEvent, readEvents } from "./event-log.ts";
import { readHookInput } from "./hook-io.ts";

const LOG_PATH = join(homedir(), ".claude", "gatekeeper-log.jsonl");
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10MB

interface HookInput {
  hook_event_name?: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  session_id?: string;
  cwd?: string;
}

interface LogEntry {
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
    const ts = new Date().toISOString().slice(0, 19);
    appendFileSync(
      LOG_PATH,
      JSON.stringify({ timestamp: ts, ...entry }) + "\n",
      "utf-8",
    );
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

function hasRecentGatekeeperEval(sessionId: string): boolean {
  const events = readEvents(sessionId);
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === "user_response") return false;
    if (ev.kind === "skill_start" && ev.skill === "gatekeeper") return true;
  }
  return false;
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

function allow(
  reason: string,
  eventName = "PreToolUse",
  additionalContext?: string,
): void {
  const hookOutput: Record<string, unknown> =
    eventName === "PermissionRequest"
      ? { hookEventName: "PermissionRequest", decision: { behavior: "allow" } }
      : {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: reason,
        };
  if (additionalContext) hookOutput.additionalContext = additionalContext;
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: hookOutput }) + "\n",
  );
  process.exit(0);
}

function block(
  reason: string,
  eventName = "PreToolUse",
  additionalContext?: string,
): void {
  const hookOutput: Record<string, unknown> =
    eventName === "PermissionRequest"
      ? { hookEventName: "PermissionRequest", decision: { behavior: "deny" } }
      : {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        };
  if (additionalContext) hookOutput.additionalContext = additionalContext;
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: hookOutput }) + "\n",
  );
  process.exit(0);
}

async function main(): Promise<void> {
  const data: HookInput = await readHookInput<HookInput>();
  const eventName = data.hook_event_name ?? "PreToolUse";
  const toolName = data.tool_name;
  const toolInput = data.tool_input ?? {};
  const summary = inputSummary(toolName, toolInput);
  const sessionId = data.session_id ?? "";
  const baseLog = {
    session_id: sessionId,
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
        decision: "allow",
        reason,
        latency_ms: 0,
      });
      allow(reason, eventName);
      return;
    }
  }

  // 0.1.5. /gatekeeper スキル自体は常に allow（自己ブロック防止）
  // event log に skill_start を記録することで以降のツール呼び出しを承認する
  if (toolName === "Skill" && String(toolInput.skill ?? "") === "gatekeeper") {
    const reason = "/gatekeeper スキル自体は除外 → 自動承認";
    try {
      appendEvent(sessionId, {
        kind: "skill_start",
        session_id: sessionId,
        skill: "gatekeeper",
        args: String(toolInput.args ?? "").slice(0, 100) || null,
        source: "claude_tool",
      });
    } catch {
      // fail-open: event log 書き込み失敗はスキル実行を止めない
    }
    writeLog({
      ...baseLog,
      decision: "allow",
      reason,
      latency_ms: 0,
    });
    allow(reason, eventName);
    return;
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
      decision: "allow",
      reason,
      latency_ms: 0,
    });
    allow(reason);
    return;
  }

  // 2. それ以外
  //   PermissionRequest: 常に allow（ネイティブダイアログ抑制）
  //   PreToolUse: 今回のユーザーターン内に /gatekeeper 評価済みなら allow、未評価なら deny
  if (eventName === "PermissionRequest") {
    const reason =
      "静的ルール対象外 → PermissionRequest allow（ダイアログ抑制）";
    writeLog({
      ...baseLog,
      decision: "allow",
      reason,
      latency_ms: 0,
    });
    allow(reason, eventName);
    return;
  }

  if (hasRecentGatekeeperEval(sessionId)) {
    const reason = "/gatekeeper 評価済み → 承認";
    writeLog({
      ...baseLog,
      decision: "allow",
      reason,
      latency_ms: 0,
    });
    allow(reason, eventName);
  } else {
    const reason = "gatekeeper: 実行前に /gatekeeper の評価が必要";
    writeLog({
      ...baseLog,
      decision: "block",
      reason,
      latency_ms: 0,
    });
    block(reason, eventName);
  }
}

main().catch((err: Error) => {
  writeLog({
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
