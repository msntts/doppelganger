#!/usr/bin/env tsx
/**
 * PreToolUse hook（MCP ツール用）— ToolSearch でスキーマ確認を促す
 *
 * matcher: "mcp__.*" に対応するフックとして設定する。
 */

import { appendFileSync } from "fs";

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  const toolName: string = data.tool_name ?? "";

  process.stderr.write(`[remind-toolsearch] ${toolName} を呼び出そうとしています。ToolSearch でスキーマ確認済みですか？\n`);
  process.exit(0);
}

main().catch(() => process.exit(0));
