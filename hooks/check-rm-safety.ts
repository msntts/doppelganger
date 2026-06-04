#!/usr/bin/env tsx
/**
 * PreToolUse hook — rm コマンドのパスを realpath で正規化し、許可ゾーン外への削除をブロックする。
 *
 * 許可ゾーン:
 *   - CWD 配下
 *   - /tmp 配下
 *
 * 設計方針:
 *   - パース・resolve 失敗時は通す（フック自体の障害でユーザー操作を止めない）
 *   - $VAR / `cmd` 展開を含むパスは検査対象外としてスキップ（過検知を避ける）
 */

import { realpathSync } from "fs";
import { homedir } from "os";
import { dirname, basename, resolve } from "path";

interface HookInput {
  tool_name: string;
  tool_input: { command?: string };
  cwd?: string;
}

// /tmp の実パスをモジュールロード時に解決（macOS では /private/tmp になる）
const REAL_TMP = (() => {
  try { return realpathSync("/tmp"); } catch { return "/tmp"; }
})();

function resolveAbsPath(p: string, cwd: string): string {
  const expanded = p === "~" ? homedir() : p.startsWith("~/") ? homedir() + p.slice(1) : p;
  const logical = resolve(cwd, expanded);
  // ファイルが存在すればそのまま展開、存在しなければ親ディレクトリを展開して結合
  // （例: /tmp/newfile → 親 /tmp → /private/tmp → /private/tmp/newfile）
  try {
    return realpathSync(logical);
  } catch {
    try {
      return basename(logical) === ""
        ? logical
        : resolve(realpathSync(dirname(logical)), basename(logical));
    } catch {
      return logical;
    }
  }
}

function normalizeCwd(cwd: string): string {
  // CWD 自体もシンボリックリンクを展開して比較基準を統一する
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}

function stripQuotes(s: string): string {
  // シングル・ダブルクォートで囲まれている場合のみ除去
  if (s.length >= 2 &&
      ((s.startsWith("'") && s.endsWith("'")) ||
       (s.startsWith('"') && s.endsWith('"')))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * コマンド文字列から rm に渡されるパス引数を抽出する。
 * ; && || | で分割し、各セグメントの rm 以降を解析する。
 */
function extractRmPaths(command: string): string[] {
  // \n（ヒアドキュメント・複数行コマンド）も区切り文字として扱う
  const segments = command.split(/\n|;|&&|\|\||(?<!\|)\|(?!\|)/);
  const paths: string[] = [];

  for (const seg of segments) {
    // ^ アンカーでセグメント先頭の rm のみを対象にする（echo 引数内の rm は無視）
    const match = seg.trim().match(/^(sudo\s+)?rm\b(.*)/);
    if (!match) continue;

    const tokens = match[2].trim().split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (token.startsWith("-")) continue; // フラグをスキップ
      const unquoted = stripQuotes(token);
      if (unquoted.includes("$") || unquoted.includes("`")) continue; // 展開はスキップ
      paths.push(unquoted);
    }
  }

  return paths;
}

function isAllowed(absPath: string, cwd: string): boolean {
  return (
    absPath === cwd ||
    absPath.startsWith(cwd + "/") ||
    absPath === REAL_TMP ||
    absPath.startsWith(REAL_TMP + "/")
  );
}

function outputBlock(rawPath: string, resolvedPath: string, cwd: string): void {
  // reason を組み立ててから JSON.stringify に渡すことで特殊文字を確実にエスケープする
  const reason = `rm パス ${JSON.stringify(rawPath)} が ${JSON.stringify(resolvedPath)} に解決されました。` +
    `許可ゾーン外（CWD: ${cwd} および /tmp 以外）への削除はブロックされます。`;
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(output) + "\n");
  process.exit(0);
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  let data: HookInput;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    process.exit(0);
  }

  if (data.tool_name !== "Bash") process.exit(0);

  const command = data.tool_input?.command ?? "";
  if (!command.includes("rm")) process.exit(0);

  const cwd = normalizeCwd(data.cwd ?? process.cwd());
  const paths = extractRmPaths(command);

  for (const p of paths) {
    const abs = resolveAbsPath(p, cwd);

    if (!isAllowed(abs, cwd)) {
      outputBlock(p, abs, cwd);
    }
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
