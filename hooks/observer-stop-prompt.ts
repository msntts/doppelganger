#!/usr/bin/env tsx
/**
 * Stop hook — pending_skill がある場合、次のアクションの選択肢をユーザーに表示する
 *
 * 選択肢:
 *   1 = 承認（そのまま続ける）
 *   2 = 修正あり（一部変えてほしい）
 *   3 = 却下（やり直し）
 *   4 = その他
 *
 * ユーザーが 1〜4 を入力すると observer-prompt.ts が response_type に直接マップする。
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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
      process.stderr.write(
        `\n[observer] /${state.pending_skill} 完了 — 次のアクションを選択: 1=承認 / 2=修正あり / 3=却下 / 4=その他\n`,
      );
    }
  } catch {
    // fail-open
  }

  process.exit(0);
}

main();
