#!/usr/bin/env tsx
/**
 * Stop hook — event log を MAX_ENTRIES 件にトリムする
 *
 * セッション中はファイルを削除しない。OS が /tmp をセッション終了後に管理する。
 */

import { existsSync } from "fs";
import { eventLogPath, trimLog } from "./event-log.ts";

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    const sessionId: string = data.session_id ?? "";
    const path = eventLogPath(sessionId);
    if (existsSync(path)) {
      trimLog(path);
    }
  } catch {
    // fail-open
  }

  process.exit(0);
}

main();
