#!/usr/bin/env tsx
/**
 * PreToolUse(Bash) — git commit 前にステージ済みファイルをフォーマットする
 *
 * - git commit で始まるコマンドのみ対象
 * - prettier config が存在する場合: TS/JS ファイルを prettier で整形
 * - pyproject.toml が存在する場合: .py ファイルを ruff format で整形
 * - 整形後に変更があればそのファイルを再ステージ
 * - fail-open: フォーマット失敗でもコミットをブロックしない
 */

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { readHookInput } from "./hook-io.ts";

interface HookInput {
  tool_name: string;
  tool_input: { command?: string };
  cwd?: string;
}

const PRETTIER_CONFIGS = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.js",
  ".prettierrc.ts",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  "prettier.config.js",
  "prettier.config.ts",
  "prettier.config.mjs",
];

function hasPrettierConfig(cwd: string): boolean {
  return PRETTIER_CONFIGS.some((f) => existsSync(join(cwd, f)));
}

function hasRuffConfig(cwd: string): boolean {
  return existsSync(join(cwd, "pyproject.toml"));
}

function getStagedFiles(cwd: string): string[] {
  const result = spawnSync("git", ["diff", "--cached", "--name-only"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) return [];
  return result.stdout.toString().trim().split("\n").filter(Boolean);
}

function spawn(cmd: string, args: string[], cwd: string): void {
  const result = spawnSync(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`${cmd} exited ${result.status}`);
}

async function main(): Promise<void> {
  try {
    const data = await readHookInput<HookInput>();

    if (data.tool_name !== "Bash") process.exit(0);

    const command = data.tool_input?.command ?? "";
    if (!command.trim().match(/^git\s+commit\b/)) process.exit(0);

    const cwd = data.cwd ?? process.cwd();
    const staged = getStagedFiles(cwd);
    if (staged.length === 0) process.exit(0);

    const formatted: string[] = [];

    // TypeScript / JavaScript
    const tsFiles = staged.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));
    if (tsFiles.length > 0 && hasPrettierConfig(cwd)) {
      try {
        spawn("pnpm", ["exec", "prettier", "--write", ...tsFiles], cwd);
        spawn("git", ["add", "--", ...tsFiles], cwd);
        formatted.push("prettier");
      } catch {
        /* fail-open */
      }
    }

    // Python
    const pyFiles = staged.filter((f) => f.endsWith(".py"));
    if (pyFiles.length > 0 && hasRuffConfig(cwd)) {
      try {
        spawn("uv", ["run", "ruff", "format", "--", ...pyFiles], cwd);
        spawn("git", ["add", "--", ...pyFiles], cwd);
        formatted.push("ruff format");
      } catch {
        /* fail-open */
      }
    }

    if (formatted.length > 0) {
      process.stderr.write(
        `[format-on-commit] ${formatted.join(", ")} 実行済み\n`,
      );
    }
  } catch {
    /* fail-open */
  }

  process.exit(0);
}

main();
