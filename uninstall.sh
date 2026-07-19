#!/usr/bin/env bash
# install.sh で張ったシンボリックリンクと settings.json のマージを取り消すアンインストールスクリプト
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

echo "アンインストール開始: $CLAUDE_DIR"

# シンボリックリンクを削除し、install 時の .bak があれば復元する
# $1: ~/.claude/ 配下のエントリ名（例: hooks, CLAUDE.md）
remove_link() {
  local name="$1"
  local target="$CLAUDE_DIR/$name"
  local backup="$CLAUDE_DIR/$name.bak"

  if [ -L "$target" ]; then
    local resolved
    resolved="$(readlink -f "$target" 2>/dev/null || true)"
    if [ "$resolved" != "$SCRIPT_DIR/$name" ]; then
      echo "  $name: doppelganger 以外へのシンボリックリンクのようです。スキップします。"
      return
    fi
    rm "$target"
    if [ -e "$backup" ]; then
      mv "$backup" "$target"
      echo "  $name: シンボリックリンクを削除し、$name.bak を復元しました"
    else
      echo "  $name: シンボリックリンクを削除しました"
    fi
  elif [ -e "$target" ]; then
    echo "  $name: シンボリックリンクではありません。スキップします。"
  else
    echo "  $name: 存在しません。スキップします。"
  fi
}

remove_link "CLAUDE.md"
remove_link "hooks"
remove_link "scripts"
remove_link "skills"
remove_link "rules"
remove_link "agents"

# --- settings.json ---
SETTINGS_SRC="$SCRIPT_DIR/settings.json"
SETTINGS_DST="$CLAUDE_DIR/settings.json"

if [ ! -f "$SETTINGS_DST" ]; then
  echo "  settings.json: 存在しません。スキップします。"
elif ! command -v jq &>/dev/null; then
  echo "  jq が見つかりません。settings.json の変更をスキップします。"
else
  cp "$SETTINGS_DST" "$SETTINGS_DST.bak"
  echo "  settings.json を settings.json.bak にバックアップしました"

  jq --argjson keys "$(jq -c 'keys' "$SETTINGS_SRC")" \
    'reduce $keys[] as $k (.; del(.[$k]))' \
    "$SETTINGS_DST" > "$SETTINGS_DST.tmp" && mv "$SETTINGS_DST.tmp" "$SETTINGS_DST"
  echo "  settings.json から doppelganger 由来のキーを削除しました"
fi

echo "完了。Claude Code を再起動してください。"
