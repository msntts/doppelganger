#!/usr/bin/env tsx
/**
 * statusLine — 1行目: モデル名・git ブランチ+変更数・コンテキスト使用率・コスト
 *              2行目: 経過時間・推論レベル・5時間レート制限使用率
 */

import { execSync } from "node:child_process";
import { basename } from "node:path";
import { readHookInput } from "./hook-io.ts";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

interface StatusLineInput {
  cwd?: string;
  model?: { display_name?: string; id?: string };
  workspace?: { current_dir?: string };
  cost?: {
    total_cost_usd?: number;
    total_duration_ms?: number;
  };
  context_window?: { used_percentage?: number | null };
  effort?: { level?: string };
  rate_limits?: { five_hour?: { used_percentage?: number } };
}

function gitSegment(cwd: string): string | null {
  const opts = {
    cwd,
    stdio: ["pipe", "pipe", "ignore"] as const,
    timeout: 1000,
  };
  try {
    execSync("git rev-parse --git-dir", opts);
    const branch = execSync("git branch --show-current", opts)
      .toString()
      .trim();
    const staged = execSync("git diff --cached --numstat", opts)
      .toString()
      .trim();
    const modified = execSync("git diff --numstat", opts).toString().trim();
    const stagedCount = staged ? staged.split("\n").length : 0;
    const modifiedCount = modified ? modified.split("\n").length : 0;

    let status = "";
    if (stagedCount > 0) status += `${GREEN}+${stagedCount}${RESET}`;
    if (modifiedCount > 0) status += `${YELLOW}~${modifiedCount}${RESET}`;
    return status ? `${branch} ${status}` : branch;
  } catch {
    return null;
  }
}

function contextColor(pct: number): string {
  if (pct >= 90) return RED;
  if (pct >= 70) return YELLOW;
  return GREEN;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m${secs}s`;
}

async function main(): Promise<void> {
  try {
    const data = await readHookInput<StatusLineInput>();
    const cwd = data.workspace?.current_dir ?? data.cwd ?? process.cwd();
    const model = data.model?.display_name ?? data.model?.id ?? "?";
    const dirName = basename(cwd);
    const pct = Math.round(data.context_window?.used_percentage ?? 0);
    const cost = (data.cost?.total_cost_usd ?? 0).toFixed(2);
    const duration = formatDuration(data.cost?.total_duration_ms ?? 0);
    const effort = data.effort?.level;
    const fiveHour = data.rate_limits?.five_hour?.used_percentage;

    const git = gitSegment(cwd);
    const line1Parts = [
      model,
      git ? `${dirName} ${git}` : dirName,
      `ctx ${contextColor(pct)}${pct}%${RESET}`,
      `$${cost}`,
    ];

    const line2Parts = [duration];
    if (effort) line2Parts.push(`eff:${effort}`);
    if (fiveHour != null) line2Parts.push(`5h:${Math.round(fiveHour)}%`);

    console.log(line1Parts.join(" | "));
    console.log(line2Parts.join(" | "));
  } catch {
    // fail-open: 何も出力しない（ステータスバーが空になるだけ）
  }
}

main();
