#!/usr/bin/env tsx
/**
 * PostToolUse hook — ファイル変更・Bash 実行を work-log.jsonl に記録する
 *
 * ログローテーション: 500KB 超で .jsonl.1 → .jsonl.2 にシフト（2世代保持）
 */

import { appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { readHookInput } from "./hook-io.ts";
import { rotateLog } from "./archive-log.ts";

const LOG_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "Bash"]);
const LOG_PATH = join(homedir(), ".claude", "work-log.jsonl");

async function main(): Promise<void> {
  const data = await readHookInput<Record<string, unknown>>();
  const toolName: string = data.tool_name ?? "";

  if (!LOG_TOOLS.has(toolName)) {
    process.exit(0);
  }

  const entry: Record<string, string> = {
    timestamp: new Date().toISOString().slice(0, 19),
    tool: toolName,
    session_id: data.session_id ?? "",
    cwd: process.cwd(),
  };

  if (toolName === "Bash") {
    entry.command = String(data.tool_input?.command ?? "").slice(0, 300);
  } else {
    entry.file = data.tool_input?.file_path ?? "";
  }

  try {
    rotateLog(LOG_PATH);
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // ロギング失敗はサイレントに無視
  }

  process.exit(0);
}

main();
