#!/usr/bin/env tsx
/**
 * PreToolUse hook — 静的ガードのみ（deny + nuanced allow）。
 * PermissionRequest は settings.json の type: "prompt" hook に委譲。
 *
 * 判定フロー:
 *   0.   denied_patterns（ALWAYS_DENY）→ 即ブロック
 *   0.1  git add/commit（安全）→ 即 allow
 *   0.2  per-project allow patterns → 即 allow
 *   0.3  debug/* ブランチ → 全操作を即 allow
 *   1.   readonly_tools.json に登録済み → 即 allow
 *   2.   それ以外 → 何も返さず exit 0（PermissionRequest → type: "prompt" へ）
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
import { readHookInput } from "./hook-io.ts";

const LOG_PATH = join(homedir(), ".claude", "gatekeeper-log.jsonl");
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10MB

interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  session_id?: string;
  cwd?: string;
}

interface LogEntry {
  session_id: string;
  tool: string;
  input_summary: string;
  decision: "allow" | "block" | "delegated" | "error";
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

async function main(): Promise<void> {
  const data: HookInput = await readHookInput<HookInput>();
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
    block(deniedReason);
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
      writeLog({ ...baseLog, decision: "allow", reason, latency_ms: 0 });
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
      writeLog({ ...baseLog, decision: "allow", reason, latency_ms: 0 });
      allow(reason);
      return;
    }
  }

  // 0.3. debug/* ブランチ: 全操作を自動承認
  const branch = currentBranch();
  if (branch?.startsWith("debug/")) {
    const reason = `debug/* ブランチのため自動承認 (branch: ${branch})`;
    writeLog({ ...baseLog, decision: "allow", reason, latency_ms: 0 });
    allow(reason);
    return;
  }

  // 1. readonly_tools（ツール名単位の静的 allow リスト）
  if (loadReadonlyTools(data.cwd).has(toolName)) {
    const reason = `${toolName}: readonly_tools に登録済みのため自動承認`;
    writeLog({ ...baseLog, decision: "allow", reason, latency_ms: 0 });
    allow(reason);
    return;
  }

  // 2. それ以外 → hookSpecificOutput を返さず exit 0
  //    PermissionRequest が発火し、type: "prompt" hook が LLM 判定する。
  writeLog({
    ...baseLog,
    decision: "delegated",
    reason: "静的ルール対象外 → PermissionRequest/type:prompt に委譲",
    latency_ms: 0,
  });
  process.exit(0);
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
  process.exit(0);
});
