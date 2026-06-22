#!/usr/bin/env tsx
/**
 * UserPromptSubmit hook — ユーザーターンの判断帰属を判定して event log と observer-log.jsonl に記録する
 *
 * 処理順序（重要）:
 *   1. event log を読んで現在ターンを分類（CLASSIFY FIRST — append 前に読む）
 *   2. user_response イベントを event log に append
 *   3. /cmd なら skill_start イベントを event log に append（次ターン用）
 *   4. observer-log.jsonl にアーカイブ書き込み（既存フォーマット維持）
 */

import { appendArchive } from "./archive-log.ts";
import {
  type ResponseType,
  type SessionEvent,
  appendEvent,
  readEvents,
} from "./event-log.ts";
import { readHookInput } from "./hook-io.ts";

const TTL_MS = 60 * 60 * 1000;

const REJECTION_RE =
  /却下|やり直し|やりなおし|なおして|直して|違う|だめ|NG|使えない|別の/i;
const MODIFICATION_RE = /でも|ただし|修正|変えて|追加して|ただ(?!し)|一方で/;
const APPROVAL_RE =
  /OK|ok|了解|承認|進めて?|進め|すすめ|続けて?|続け|問題ない|大丈夫|いいです|そうです|はい|お願いします?|おねがい|コミットして|pushして|push\s+して|わかった|わかりました|LGTM|了承|それで|お願い/;

const SELECTION_MAP: Record<string, ResponseType> = {
  "1": "approval",
  "2": "modification",
  "3": "rejection",
  "4": "unclear",
};

function classifyResponse(text: string): ResponseType {
  const trimmed = text.trim();
  if (SELECTION_MAP[trimmed]) return SELECTION_MAP[trimmed];
  if (REJECTION_RE.test(text)) return "rejection";
  if (MODIFICATION_RE.test(text)) return "modification";
  if (text.length <= 50 && APPROVAL_RE.test(text)) return "approval";
  return "unclear";
}

function findPrecedingSkill(
  events: SessionEvent[],
  now: Date,
): { skill: string; ts: string; elapsedSec: number } | null {
  // Walk backwards: first user_response → no pending; first skill_start → found
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === "user_response") return null;
    if (ev.kind === "skill_start") {
      const elapsed = now.getTime() - new Date(ev.ts).getTime();
      if (elapsed > TTL_MS) return null;
      return {
        skill: ev.skill,
        ts: ev.ts,
        elapsedSec: Math.round(elapsed / 1000),
      };
    }
    // agent_invoked: skip
  }
  return null;
}

async function main(): Promise<void> {
  try {
    const data = await readHookInput<Record<string, unknown>>();
    const sessionId: string = data.session_id ?? "";
    const prompt: string = data.prompt ?? "";
    const now = new Date();
    const cwd = process.cwd();

    // 1. CLASSIFY using events read BEFORE this turn's append
    const events = readEvents(sessionId);
    const preceding = findPrecedingSkill(events, now);

    // スラッシュコマンドは新タスク起動 — 直前スキルへの応答ではなく autonomous 扱い
    const isNewSkillInvocation = /^\/[a-zA-Z]/.test(prompt.trim());

    const humanAttribution: "autonomous" | "post_ai" =
      preceding && !isNewSkillInvocation ? "post_ai" : "autonomous";

    const responseType =
      preceding && !isNewSkillInvocation ? classifyResponse(prompt) : undefined;

    // 2. Append user_response
    const userEvent: Omit<import("./event-log.ts").UserResponseEvent, "ts"> = {
      kind: "user_response",
      session_id: sessionId,
      human_attribution: humanAttribution,
      prompt_preview: prompt.slice(0, 200),
      prompt_len: prompt.length,
      cwd,
    };
    if (preceding && !isNewSkillInvocation) {
      userEvent.response_type = responseType;
      userEvent.preceding_skill = preceding.skill;
      userEvent.ai_elapsed_sec = preceding.elapsedSec;
    }
    appendEvent(sessionId, userEvent);

    // 3. If /cmd → append skill_start for next turn
    const slashMatch = prompt.match(/^\/([a-zA-Z][\w-]*)(?:\s|$)/);
    if (slashMatch) {
      appendEvent(sessionId, {
        kind: "skill_start",
        session_id: sessionId,
        skill: slashMatch[1],
        args: null,
        source: "user_cmd",
      });
    }

    // 4. Archive to observer-log.jsonl (existing format, unchanged)
    const archiveEntry: Record<string, unknown> = {
      timestamp: now.toISOString().slice(0, 19),
      session_id: sessionId,
      event_type: "user_turn",
      prompt_preview: prompt.slice(0, 200),
      prompt_len: prompt.length,
      human_attribution: humanAttribution,
      cwd,
    };
    if (preceding && !isNewSkillInvocation) {
      archiveEntry.response_type = responseType;
      archiveEntry.preceding_skill = preceding.skill;
      archiveEntry.preceding_skill_ts = preceding.ts;
      archiveEntry.ai_elapsed_sec = preceding.elapsedSec;
    }
    appendArchive(archiveEntry);
  } catch {
    // fail-open
  }

  process.exit(0);
}

main();
