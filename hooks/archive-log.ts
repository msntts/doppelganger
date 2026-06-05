/**
 * ログローテーションとアーカイブ追記のユーティリティ
 *
 * rotateLog: 任意パスに対して 500KB/2-gen ローテーションを行う汎用関数
 * appendArchive: observer-log.jsonl への rotate + append をまとめた関数
 *
 * gatekeeper の 10MB/1-gen ローテーションはこのモジュールを使わない
 */

import { appendFileSync, existsSync, renameSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const OBSERVER_LOG_PATH = join(homedir(), ".claude", "observer-log.jsonl");

export function rotateLog(
  path: string,
  maxBytes = 500 * 1024,
  backups = 2,
): void {
  if (!existsSync(path) || statSync(path).size < maxBytes) return;
  for (let i = backups; i >= 1; i--) {
    const src = i === 1 ? path : `${path}.${i - 1}`;
    const dst = `${path}.${i}`;
    if (existsSync(src)) renameSync(src, dst);
  }
}

export function appendArchive(entry: Record<string, unknown>): void {
  rotateLog(OBSERVER_LOG_PATH);
  appendFileSync(OBSERVER_LOG_PATH, JSON.stringify(entry) + "\n", "utf-8");
}
