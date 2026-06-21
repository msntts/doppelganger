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

# --- scripts/ ---
if [ -L "$CLAUDE_DIR/scripts" ]; then
  rm "$CLAUDE_DIR/scripts"
elif [ -d "$CLAUDE_DIR/scripts" ]; then
  mv "$CLAUDE_DIR/scripts" "$CLAUDE_DIR/scripts.bak"
  echo "  既存の scripts/ を scripts.bak/ にバックアップしました"
fi
MSYS=winsymlinks:nativestrict ln -s "$SCRIPT_DIR/scripts" "$CLAUDE_DIR/scripts"
echo "  scripts/ のシンボリックリンクを作成しました"

# --- skills/ ---
if [ -L "$CLAUDE_DIR/skills" ]; then
  rm "$CLAUDE_DIR/skills"
elif [ -d "$CLAUDE_DIR/skills" ]; then
  mv "$CLAUDE_DIR/skills" "$CLAUDE_DIR/skills.bak"
  echo "  既存の skills/ を skills.bak/ にバックアップしました"
fi
MSYS=winsymlinks:nativestrict ln -s "$SCRIPT_DIR/skills" "$CLAUDE_DIR/skills"
echo "  skills/ のシンボリックリンクを作成しました"

# --- rules/ ---
if [ -L "$CLAUDE_DIR/rules" ]; then
  rm "$CLAUDE_DIR/rules"
elif [ -d "$CLAUDE_DIR/rules" ]; then
  mv "$CLAUDE_DIR/rules" "$CLAUDE_DIR/rules.bak"
  echo "  既存の rules/ を rules.bak/ にバックアップしました"
fi
MSYS=winsymlinks:nativestrict ln -s "$SCRIPT_DIR/rules" "$CLAUDE_DIR/rules"
echo "  rules/ のシンボリックリンクを作成しました"

# --- agents/ ---
if [ -L "$CLAUDE_DIR/agents" ]; then
  rm "$CLAUDE_DIR/agents"
elif [ -d "$CLAUDE_DIR/agents" ]; then
  mv "$CLAUDE_DIR/agents" "$CLAUDE_DIR/agents.bak"
  echo "  既存の agents/ を agents.bak/ にバックアップしました"
fi
MSYS=winsymlinks:nativestrict ln -s "$SCRIPT_DIR/agents" "$CLAUDE_DIR/agents"
echo "  agents/ のシンボリックリンクを作成しました"

# --- settings.json のマージ ---
# settings.json はシンボリックリンクにしない。
# doppelganger/settings.json の hooks・permissions・model・extraKnownMarketplaces・advisorModel を
# ~/.claude/settings.json へ idempotent にマージする。
# Claude Code が settings.json を書き換えても他のキーは保持される。
SETTINGS_SRC="$SCRIPT_DIR/settings.json"
SETTINGS_DST="$CLAUDE_DIR/settings.json"

# シンボリックリンクが残っていたら実ファイルに戻す
if [ -L "$SETTINGS_DST" ]; then
  cp --dereference "$SETTINGS_DST" "$SETTINGS_DST.tmp" && mv "$SETTINGS_DST.tmp" "$SETTINGS_DST"
  echo "  settings.json のシンボリックリンクを実ファイルに変換しました"
fi

if ! command -v jq &>/dev/null; then
  echo "  jq が見つかりません。settings.json のマージをスキップします。"
  echo "  jq をインストール後に install.sh を再実行してください。"
else
  if [ ! -f "$SETTINGS_DST" ]; then
    echo "{}" > "$SETTINGS_DST"
  fi
  # src のキーで dst を上書きマージ（dst 側の独自キーは保持）
  jq -s '.[0] * .[1]' "$SETTINGS_DST" "$SETTINGS_SRC" > "$SETTINGS_DST.tmp" && mv "$SETTINGS_DST.tmp" "$SETTINGS_DST"
  echo "  settings.json をマージしました"
fi

echo "完了。Claude Code を再起動してください。"
echo ""
echo "ヒント: /tune でハーネスの承認ルールを自動チューニングできます。"
echo "       ログが蓄積する 30 日後以降に実行すると候補精度が上がります。"
