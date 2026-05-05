#!/usr/bin/env bash
set -euo pipefail

ARG="${1:-open}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

OS_RAW="$(uname -s 2>/dev/null || echo "Windows")"
if   [[ "$OS_RAW" == "Darwin"                          ]]; then _OS="mac"
elif [[ "$OS_RAW" == MINGW* || "$OS_RAW" == CYGWIN* || "$OS_RAW" == "Windows" ]]; then _OS="windows"
else
  echo "非対応の OS です（検出: $OS_RAW）。Mac または Windows で実行してください。"
  exit 1
fi

if [[ "$_OS" == "mac" ]]; then

  # ── Mac (tmux) ──────────────────────────────────────────────────────

  command -v tmux &>/dev/null || { echo "tmux がインストールされていません。\`brew install tmux\` でインストールできます。"; exit 1; }
  [[ -n "${TMUX:-}" ]] || { echo "tmux セッション外では使えません。ターミナルで \`tmux\` を実行してから Claude Code を起動してください。"; exit 1; }
  command -v broot &>/dev/null || { echo "broot がインストールされていません。\`brew install broot\` でインストールできます。"; exit 1; }

  TARGET="${ARG#@}"
  if   [[ -z "$TARGET" || "$TARGET" == "open"  ]]; then MODE="open"
  elif [[ "$TARGET" == "close"                  ]]; then MODE="close"
  else                                                   MODE="path"
  fi

  case "$MODE" in
    open)
      if tmux list-panes -F "#{pane_index} #{pane_current_command}" | grep -iq broot; then
        echo "すでに開いています。\`Ctrl+b l\` で移動できます。"
      else
        tmux split-window -h -c "#{pane_current_path}" "broot ."
        echo "右ペインに broot を開きました。\`Ctrl+b l\` で移動できます。"
      fi
      ;;
    close)
      PANE_IDX=$(tmux list-panes -F "#{pane_index} #{pane_current_command}" | grep -i broot | awk '{print $1}' | head -1 || true)
      if [[ -z "$PANE_IDX" ]]; then
        echo "broot ペインが見つかりません。"; exit 1
      fi
      tmux kill-pane -t "$PANE_IDX"
      echo "broot ペインを閉じました。"
      ;;
    path)
      [[ "$TARGET" == /* ]] || TARGET="$(pwd)/$TARGET"
      [[ -e "$TARGET" ]] || { echo "\`$TARGET\` が見つかりません。"; exit 1; }
      if [[ -d "$TARGET" ]]; then
        TARGET_DIR="$TARGET"; QUERY=""
      else
        TARGET_DIR="$(dirname "$TARGET")"; QUERY="$(basename "$TARGET")"
      fi
      PANE_IDX=$(tmux list-panes -F "#{pane_index} #{pane_current_command}" | grep -i broot | awk '{print $1}' | head -1 || true)
      [[ -z "$PANE_IDX" ]] || tmux kill-pane -t "$PANE_IDX"
      if [[ -z "$QUERY" ]]; then
        tmux split-window -h -c "#{pane_current_path}" "broot $(printf '%q' "$TARGET_DIR")"
      else
        tmux split-window -h -c "#{pane_current_path}" "broot $(printf '%q' "$TARGET_DIR") --cmd $(printf '%q' "$QUERY")"
      fi
      echo "右ペインに broot を開き、\`$ARG\` にフォーカスしました。\`Ctrl+b l\` で移動できます。"
      ;;
  esac

else

  # ── Windows (PowerShell) ─────────────────────────────────────────────

  WIN_SCRIPT="$(cygpath -w "$SCRIPT_DIR/filetree-win.ps1" 2>/dev/null || echo "$SCRIPT_DIR/filetree-win.ps1")"
  pwsh -NoProfile -File "$WIN_SCRIPT" "$ARG"

fi
