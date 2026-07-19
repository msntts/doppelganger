#!/usr/bin/env bash
# install.sh で張ったシンボリックリンクと settings.json のマージを取り消すアンインストールスクリプト
#
# --purge を付けると settings.json のバックアップを作成せず、
# 既存の settings.json.bak / *.bak も削除する完全クリーンアンインストールになる（復元不可）。
set -euo pipefail

PURGE=false
if [ "${1:-}" = "--purge" ]; then
  PURGE=true
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

echo "アンインストール開始: $CLAUDE_DIR"
if [ "$PURGE" = true ]; then
  echo "（--purge: バックアップを残さない完全クリーンモード）"
fi

# シンボリックリンクを削除し、install 時の .bak があれば復元する（--purge 時は .bak も削除する）
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
    if [ "$PURGE" = true ] && [ -e "$backup" ]; then
      rm -rf "$backup"
      echo "  $name: シンボリックリンクを削除し、$name.bak も削除しました"
    elif [ -e "$backup" ]; then
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
  if [ "$PURGE" = true ]; then
    echo "  settings.json: --purge のためバックアップを作成しません"
  else
    cp "$SETTINGS_DST" "$SETTINGS_DST.bak"
    echo "  settings.json を settings.json.bak にバックアップしました"
  fi

  jq --argjson keys "$(jq -c 'keys' "$SETTINGS_SRC")" \
    'reduce $keys[] as $k (.; del(.[$k]))' \
    "$SETTINGS_DST" > "$SETTINGS_DST.tmp" && mv "$SETTINGS_DST.tmp" "$SETTINGS_DST"
  echo "  settings.json から doppelganger 由来のキーを削除しました"
fi

if [ "$PURGE" = true ] && [ -f "$SETTINGS_DST.bak" ]; then
  rm -f "$SETTINGS_DST.bak"
  echo "  既存の settings.json.bak を削除しました"
fi

echo "完了。Claude Code を再起動してください。"
