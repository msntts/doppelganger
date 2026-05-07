---
name: filetree
description: ファイルツリーを右ペインで開閉する。「ツリー開いて」「ファイル一覧見たい」「broot 開いて」「ツリー閉じて」等で使う。Mac は tmux、Windows は Windows Terminal を使用。引数にファイル/ディレクトリパスを渡すとそこにフォーカスして開く。
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
