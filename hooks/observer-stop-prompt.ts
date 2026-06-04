#!/usr/bin/env tsx
/**
 * Stop hook — pending_skill がある場合、次のアクションの選択肢をユーザーに表示する
 *
 * 選択肢（レビュー系）:
 *   1 = 承認（そのまま続ける）
 *   2 = 修正あり（一部変えてほしい）
 *   3 = 却下（やり直し）
 *   4 = その他
 *
 * 選択肢（タスク系スキル）:
 *   1 = 成功（完了）
 *   2 = 部分的（一部未達）
 *   3 = 失敗（やり直し）
 *   4 = その他
 *
 * ユーザーが 1〜4 を入力すると observer-prompt.ts が response_type に直接マップする。
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// データ取得・完了系スキル（「承認/却下」より「成功/失敗」の語が合う）
const TASK_COMPLETION_SKILLS = new Set([
  "freee",
  "kot",
  "gcal-week",
  "pl-extract",
  "analyze-observer",
]);

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    const sessionId: string = data.session_id ?? "";
    const stateFile = join(tmpdir(), `claude_observer_${sessionId}.json`);

    if (!existsSync(stateFile)) {
      process.exit(0);
    }

    const state = JSON.parse(readFileSync(stateFile, "utf-8"));

    if (state.pending_skill) {
      if (TASK_COMPLETION_SKILLS.has(state.pending_skill)) {
        process.stderr.write(
          `\n[observer] /${state.pending_skill} 完了 — 成否を記録: 1=成功 / 2=部分的 / 3=失敗 / 4=その他\n`,
        );
      } else {
        process.stderr.write(
          `\n[observer] /${state.pending_skill} 完了 — 次のアクションを選択: 1=承認 / 2=修正あり / 3=却下 / 4=その他\n`,
        );
      }
    }
  } catch {
    // fail-open
  }

  process.exit(0);
}

main();
