#!/usr/bin/env bash
# ~/.claude/ へシンボリックリンクを張るインストールスクリプト
# Windows 11 の場合、事前に「開発者モード」を有効にしてください。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

echo "インストール開始: $SCRIPT_DIR -> $CLAUDE_DIR"
mkdir -p "$CLAUDE_DIR"

# tsx の確認
if ! command -v tsx &>/dev/null; then
  echo "tsx が見つかりません。pnpm add -g tsx でインストールしてください。"
  exit 1
fi

# --- pnpm install（型定義等） ---
cd "$SCRIPT_DIR"
pnpm install --silent
cd - >/dev/null

# --- CLAUDE.md ---
if [ -L "$CLAUDE_DIR/CLAUDE.md" ]; then
  rm "$CLAUDE_DIR/CLAUDE.md"
elif [ -f "$CLAUDE_DIR/CLAUDE.md" ]; then
  mv "$CLAUDE_DIR/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md.bak"
  echo "  既存の CLAUDE.md を CLAUDE.md.bak にバックアップしました"
fi
MSYS=winsymlinks:nativestrict ln -s "$SCRIPT_DIR/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md"
echo "  CLAUDE.md のシンボリックリンクを作成しました"

# --- hooks/ ---
if [ -L "$CLAUDE_DIR/hooks" ]; then
  rm "$CLAUDE_DIR/hooks"
elif [ -d "$CLAUDE_DIR/hooks" ]; then
  mv "$CLAUDE_DIR/hooks" "$CLAUDE_DIR/hooks.bak"
  echo "  既存の hooks/ を hooks.bak/ にバックアップしました"
fi
MSYS=winsymlinks:nativestrict ln -s "$SCRIPT_DIR/hooks" "$CLAUDE_DIR/hooks"
echo "  hooks/ のシンボリックリンクを作成しました"

# --- skills/ ---
if [ -L "$CLAUDE_DIR/skills" ]; then
  rm "$CLAUDE_DIR/skills"
elif [ -d "$CLAUDE_DIR/skills" ]; then
  mv "$CLAUDE_DIR/skills" "$CLAUDE_DIR/skills.bak"
  echo "  既存の skills/ を skills.bak/ にバックアップしました"
fi
MSYS=winsymlinks:nativestrict ln -s "$SCRIPT_DIR/skills" "$CLAUDE_DIR/skills"
echo "  skills/ のシンボリックリンクを作成しました"

# --- settings.json ---
SETTINGS_SRC="$SCRIPT_DIR/settings.json"
SETTINGS_DST="$CLAUDE_DIR/settings.json"
if [ -L "$SETTINGS_DST" ]; then
  rm "$SETTINGS_DST"
elif [ -f "$SETTINGS_DST" ]; then
  mv "$SETTINGS_DST" "$SETTINGS_DST.bak"
  echo "  既存の settings.json を settings.json.bak にバックアップしました"
fi
MSYS=winsymlinks:nativestrict ln -s "$SETTINGS_SRC" "$SETTINGS_DST"
echo "  settings.json のシンボリックリンクを作成しました"

echo "完了。Claude Code を再起動してください。"
