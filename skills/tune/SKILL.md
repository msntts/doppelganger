---
name: tune
description: |
  observer・gatekeeper ログを分析し、allow/deny パターン候補を提示してハーネスの承認ルールをチューニングする。
  「チューニングして」「allow パターン候補見せて」「deny パターン追加したい」「承認ルールを改善して」
  「よく使うコマンドを自動承認にして」「ブロックパターンを学習させて」等で使う。

  自動承認してほしいコマンドと、常時ブロックしたいコマンドを、過去のログから提案する。
  `fewer-permission-prompts` スキル（settings.json permissions.allow）とは別系統。
  こちらは hooks/gatekeeper.ts 経由の allow/deny_patterns.json を操作する。
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# /tune

過去 30 日の gatekeeper・observer ログを分析し、project-local `.claude/` の allow/deny パターン設定を更新する。

---

## 実行フロー

### 1. 候補の収集

Bash ツールで tune-helper を実行する:

```bash
tsx ~/.claude/scripts/tune-helper.ts --project $(pwd) 2>/dev/null || npx --yes tsx ~/.claude/scripts/tune-helper.ts --project $(pwd) 2>/dev/null
```

出力 JSON をパースする:
```typescript
{
  allow_candidates: Array<{ pattern: string; count: number; examples: string[] }>;
  deny_candidates: Array<{ pattern: string; count: number; examples: string[] }>;
  skipped_count: number;
}
```

`allow_candidates` と `deny_candidates` が両方空なら:
```
候補が見つかりませんでした。ログが不足しているか、すべて登録済みです。
（tune-helper から除外された候補: {skipped_count} 件）
```
と表示して終了する。

---

### 2. 候補の表示

以下のフォーマットで候補を表示する:

```
## /tune — ハーネス自動チューニング

📊 過去 30 日のログを分析しました（プロジェクト: {basename(pwd)}）
{allow_candidates.length} 件の allow 候補 / {deny_candidates.length} 件の deny 候補

### allow_patterns 候補（自動承認に追加）

1. `{pattern}` — {count} 回使用
   例: {examples[0]}
   例: {examples[1]}  ← examples が 2 件以上あるときのみ

2. `{pattern}` — {count} 回使用
   ...

### deny_patterns 候補（常時ブロックに追加）

A. `{pattern}` — {count} 回 rejection
   例: {examples[0]}

...

---
採用するものを番号・記号で指定してください（スペース区切り）:
  1 2 A      → 1・2・A を採用
  s1 sA      → 1・A をスキップ（次回から除外）
  all        → すべて採用
  none       → 何もしない（今回はスキップせず終了）
```

`allow_candidates` が空なら「### allow_patterns 候補」セクション全体を省略する。
`deny_candidates` が空なら「### deny_patterns 候補」セクション全体を省略する。

---

### 3. ユーザー入力の解釈

ユーザーの返答を受け取り、以下のルールで解釈する:

- `all` → すべての候補を採用
- `none` → 何もせず終了（スキップ登録もしない）
- 数字（`1`・`2` 等）→ 対応する allow 候補を採用
- 大文字アルファベット（`A`・`B` 等）→ 対応する deny 候補を採用
- `s` + 番号/記号（`s1`・`sA` 等）→ 対応する候補をスキップリストに追加（採用しない）
- 上記が混在しても良い: `1 s2 A sB`

---

### 4. JSON ファイルへの書き込み

#### allow_patterns.json

対象パス: `{cwd}/.claude/allow_patterns.json`

ファイルが存在しない場合は `{ "bash": [] }` を初期値として作成する。
ファイルが存在する場合は Read ツールで読み込む。

採用された allow 候補を `bash` 配列に追加する（重複は追加しない）。
Write ツールで書き込む（整形済み JSON、インデント2スペース）。

#### denied_patterns.json

対象パス: `{cwd}/.claude/denied_patterns.json`

ファイルが存在しない場合は `{ "tools": [], "bash_patterns": [] }` を初期値として作成する。
ファイルが存在する場合は Read ツールで読み込む。

採用された deny 候補を `bash_patterns` 配列に追加する（重複は追加しない）。
Write ツールで書き込む（整形済み JSON、インデント2スペース）。

---

### 5. tune-skip.json の更新

対象パス: `~/.claude/tune-skip.json`（グローバル）

`s` プレフィックスで指定されたパターンを記録する。

ファイルが存在しない場合は `{ "patterns": [] }` を初期値として作成する。
ファイルが存在する場合は Read ツールで読み込む。

スキップされたパターンを `patterns` 配列に追加する（重複は追加しない）。
Write ツールで書き込む。

---

### 6. git commit

変更があった場合のみ実行する。

```bash
git add .claude/allow_patterns.json .claude/denied_patterns.json 2>/dev/null; git add ~/.claude/tune-skip.json 2>/dev/null; true
```

上記の add 後、変更がステージされていれば:

```bash
git commit -m "feat(tune): allow/deny パターンを {N} 件追加

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

commit 後、以下を報告する:

```
✅ {N} 件のパターンを追加しました。
  allow: {採用した allow パターン一覧}
  deny:  {採用した deny パターン一覧}
{スキップがあれば}  skip:  {スキップしたパターン一覧}（次回から除外）
```

---

## 注意事項

- `~/.claude/tune-skip.json` は global のため git commit 対象外（`.claude/*.json` のみ commit する）
- project-local `.claude/` ディレクトリは `/tune` を呼ぶたびに自動生成される
- 候補が 0 件の場合はログが少ないかすべて登録済み。正常な状態
