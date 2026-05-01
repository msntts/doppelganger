#!/usr/bin/env tsx
/**
 * UserPromptSubmit / Stop hook — macOS スリープ抑制
 *
 * UserPromptSubmit: caffeinate -di を起動してスリープ・画面ロックを防ぐ
 * Stop:            caffeinate を終了してスリープ抑制を解除する
 *
 * macOS 以外では何もしない。
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { spawnSync, execFileSync } from "child_process";

const PID_FILE = "/tmp/claude_caffeinate.pid";

function start(): void {
  if (process.platform !== "darwin") return;

  if (existsSync(PID_FILE)) {
    try {
      const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
      process.kill(pid, 0);
      return; // 既に起動中
    } catch {
      // PID が無効なら再起動
    }
  }

  const proc = spawnSync("caffeinate", ["-di"], {
    detached: true,
    stdio: "ignore",
  } as never);

  if ((proc as { pid?: number }).pid) {
    writeFileSync(PID_FILE, String((proc as { pid: number }).pid), "utf-8");
  }
}

function stop(): void {
  if (process.platform !== "darwin") return;
  if (!existsSync(PID_FILE)) return;

  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    process.kill(pid, "SIGTERM");
  } catch {
    // プロセスが既に終了していれば無視
  } finally {
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
  }
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  const event: string = data.hook_event_name ?? data.hookEventName ?? "";

  if (event === "Stop") {
    stop();
  } else {
    start();
  }
}

main().catch(() => process.exit(0));
