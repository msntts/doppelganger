#!/usr/bin/env tsx
/**
 * PostToolUse hook (matcher: Agent) — Agent 完了を event log と observer-log.jsonl に記録する
 *
 * ログローテーション: 500KB 超で .jsonl.1 → .jsonl.2 にシフト（2世代保持）
 */

import { appendEvent } from "./event-log.ts";
import { readHookInput } from "./hook-io.ts";
import { appendArchive } from "./archive-log.ts";

async function main(): Promise<void> {
  try {
    const data = await readHookInput<Record<string, unknown>>();

    if (data.tool_name !== "Agent") {
      process.exit(0);
    }

    const sessionId: string = data.session_id ?? "";
    const description = String(data.tool_input?.description ?? "").slice(
      0,
      100,
    );
    const cwd = process.cwd();

    // IPC event log
    appendEvent(sessionId, {
      kind: "agent_invoked",
      session_id: sessionId,
      description,
      cwd,
    });

    // long-term archive (existing format, unchanged)
    appendArchive({
      timestamp: new Date().toISOString().slice(0, 19),
      session_id: sessionId,
      event_type: "agent_invoked",
      agent_description: description,
      cwd,
    });
  } catch {
    // fail-open
  }

  process.exit(0);
}

main();
