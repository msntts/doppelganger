#!/usr/bin/env tsx
/**
 * PreToolUse hook (matcher: Skill) — Skill 呼び出しを event log に記録する
 */

import { appendEvent } from "./event-log.ts";

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

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
