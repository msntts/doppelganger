---
name: filetree
description: 右ペインで broot ファイルツリーを開く・閉じる（Mac: tmux、Windows: Windows Terminal）。ファイルパスを渡すとそのファイルにフォーカスした状態で開く
user-invocable: true
---

引数: `$ARGUMENTS`（`open`・`close`・ファイル/ディレクトリのパス。省略時は `open`）

## 実行

ベースディレクトリの `filetree.sh` を bash で実行する。

```bash
bash "<base_dir>/filetree.sh" "$ARGUMENTS"
```

`<base_dir>` はヘッダーの `Base directory for this skill:` の値に置き換える。

標準出力をそのままユーザーに伝える。
