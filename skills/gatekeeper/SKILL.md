---
name: gatekeeper
description: ツール実行の安全性を自己評価する。「これ実行して大丈夫？」「このコマンド安全？」「操作前に確認したい」等で使う。CLAUDE.md ルールにより、readonly 系以外の操作前に自動起動する。
user-invocable: true
allowed-tools: Read, Bash
---

# /gatekeeper

実行しようとしている操作を受け取り、allow / ask / block のいずれかを推奨する。

引数: `$ARGUMENTS`（評価したいツール名と入力内容を自然言語で渡す）

---

## 実行フロー

## 判定手順

### 1. プロジェクト固有ポリシーの確認

カレントディレクトリの `.claude/approval_policy.md` を Read ツールで読み込む（存在する場合のみ）。
以降の判定ではグローバルルールよりプロジェクトポリシーを優先する。

### 2. カテゴリ分類

操作を以下のいずれかに分類する。

| category       | 該当する操作の例                                                        | デフォルト判定 |
| -------------- | ----------------------------------------------------------------------- | -------------- |
| readonly       | cat/grep/find、git status/log/diff、ls/ps/env、curl GET、git fetch/pull | allow          |
| git_local      | git add、git commit（--amend なし）                                     | allow          |
| git_remote     | git push（force なし）                                                  | ask            |
| external_write | 外部 API への POST/PUT/DELETE、clasp push、S3 upload                    | ask            |
| system_write   | ~/.ssh/・~/.aws/・/etc/ など git 管理外への書き込み                     | ask            |
| destructive    | rm -rf、DROP TABLE/DATABASE、git push --force、git reset --hard         | block          |
| uncertain      | 上記に当てはまらない、または判断材料が不足                              | ask            |

**分類の哲学**:

- 外部・共有リソースへのアクセスは「書き込むか読み取るか」を先に判断する。読み取りなら readonly。
- git 管理下のファイルシステム破壊操作（`rm` 等）は `git reflog` で復元可能なため allow に格上げする。
- 迷ったら uncertain にする（allow/ask/block を憶測で決めない）。

### 3. 推奨を出力

以下のフォーマットで推奨を返す：

```
判定: allow / ask / block
カテゴリ: <category>
理由: <一文>
```

- `ask` の場合: ユーザーへ伝えるべきリスクの説明を添える。
- `block` の場合: なぜ実行すべきでないかを明示する。
- `allow` の場合: 簡潔に安全と判断した根拠を示す。
