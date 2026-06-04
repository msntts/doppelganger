#!/usr/bin/env tsx
/**
 * Stop hook — 未消費の skill_start がある場合、ユーザーに選択肢を表示する
 */

import { type SessionEvent, readEvents } from "./event-log.ts";

const TTL_MS = 60 * 60 * 1000;

const TASK_COMPLETION_SKILLS = new Set([
  "freee",
  "kot",
  "gcal-week",
  "pl-extract",
  "analyze-observer",
]);

function findPendingSkill(events: SessionEvent[], now: Date): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === "user_response") return null;
    if (ev.kind === "skill_start") {
      const elapsed = now.getTime() - new Date(ev.ts).getTime();
      if (elapsed > TTL_MS) return null;
      return ev.skill;
    }
    // agent_invoked: skip
  }
  return null;
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    const sessionId: string = data.session_id ?? "";

    const events = readEvents(sessionId);
    const pendingSkill = findPendingSkill(events, new Date());

    if (pendingSkill) {
      if (TASK_COMPLETION_SKILLS.has(pendingSkill)) {
        process.stderr.write(
          `\n[observer] /${pendingSkill} 完了 — 成否を記録: 1=成功 / 2=部分的 / 3=失敗 / 4=その他\n`,
        );
      } else {
        process.stderr.write(
          `\n[observer] /${pendingSkill} 完了 — 次のアクションを選択: 1=承認 / 2=修正あり / 3=却下 / 4=その他\n`,
        );
      }
    }
  } catch {
    // fail-open
  }

  process.exit(0);
}

main();
