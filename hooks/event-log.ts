/**
 * Doppelganger event log — session-scoped IPC bus in tmpdir
 *
 * Producers append events; consumers read the last MAX_ENTRIES lines.
 * The file is a rolling JSONL buffer: trim-on-append, never deleted mid-session.
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

export const MAX_ENTRIES = 100;

export type ResponseType = "approval" | "modification" | "rejection" | "unclear";

export interface SkillStartEvent {
  ts: string;
  kind: "skill_start";
  session_id: string;
  skill: string;
  args: string | null;
  source: "user_cmd" | "claude_tool";
}

export interface AgentInvokedEvent {
  ts: string;
  kind: "agent_invoked";
  session_id: string;
  description: string;
  cwd: string;
}

export interface UserResponseEvent {
  ts: string;
  kind: "user_response";
  session_id: string;
  human_attribution: "autonomous" | "post_ai";
  response_type?: ResponseType;
  preceding_skill?: string;
  ai_elapsed_sec?: number;
  prompt_preview: string;
  prompt_len: number;
  cwd: string;
}

export type SessionEvent =
  | SkillStartEvent
  | AgentInvokedEvent
  | UserResponseEvent;

export function eventLogPath(sessionId: string): string {
  return join(tmpdir(), `claude_events_${sessionId}.jsonl`);
}

export function appendEvent(
  sessionId: string,
  event:
    | Omit<SkillStartEvent, "ts">
    | Omit<AgentInvokedEvent, "ts">
    | Omit<UserResponseEvent, "ts">,
): void {
  const path = eventLogPath(sessionId);
  appendFileSync(
    path,
    JSON.stringify({ ts: new Date().toISOString().slice(0, 19), ...event }) +
      "\n",
    "utf-8",
  );
  // best-effort trim: read-modify-write is not atomic; acceptable for single-user IPC
  try {
    trimLog(path);
  } catch {
    // fail-open
  }
}

export function readEvents(sessionId: string): SessionEvent[] {
  const path = eventLogPath(sessionId);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => JSON.parse(l) as SessionEvent)
      .slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function trimLog(path: string): void {
  const content = readFileSync(path, "utf-8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length > MAX_ENTRIES) {
    writeFileSync(
      path,
      lines.slice(-MAX_ENTRIES).join("\n") + "\n",
      "utf-8",
    );
  }
}
