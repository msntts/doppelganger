#!/usr/bin/env bash
# doppelganger/settings.json を ~/.claude/settings.json にマージする
# install.sh の settings.json マージ部分のみを抽出したもの
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/settings.json"
DST="$HOME/.claude/settings.json"

if ! command -v jq &>/dev/null; then
  echo "エラー: jq が見つかりません。インストールしてください。" >&2
  exit 1
fi

trap 'rm -f "$DST.tmp"' EXIT

if [ ! -f "$DST" ]; then
  printf '{}' > "$DST"
fi

cp "$DST" "$DST.bak"
jq -s '.[0] * .[1]' "$DST" "$SRC" > "$DST.tmp" && mv "$DST.tmp" "$DST"
echo "settings.json を同期しました: $SRC -> $DST"
