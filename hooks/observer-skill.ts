#!/usr/bin/env tsx
/**
 * PreToolUse hook (matcher: Skill) — Skill 呼び出しを event log に記録する
 */

import { appendEvent } from "./event-log.ts";
import { readHookInput } from "./hook-io.ts";

async function main(): Promise<void> {
  try {
    const data = await readHookInput<Record<string, unknown>>();

    if (data.tool_name !== "Skill") {
      process.exit(0);
    }

    const sessionId: string = data.session_id ?? "";
    const skill: string = data.tool_input?.skill ?? "";
    const args = String(data.tool_input?.args ?? "").slice(0, 100) || null;

    appendEvent(sessionId, {
      kind: "skill_start",
      session_id: sessionId,
      skill,
      args,
      source: "claude_tool",
    });
  } catch {
    // fail-open
  }

  process.exit(0);
}

main();
