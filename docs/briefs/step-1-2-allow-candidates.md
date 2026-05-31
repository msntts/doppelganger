# Step 1-2: allow 候補抽出ロジック

## 前提条件
- `hooks/tune-helper.ts` が存在し、`extractAllowCandidates` スタブが定義されていること（1-1 完了後）

## 制約（触らないもの）
- NEVER_AUTO_SUGGEST リストは変更しない
- 出力 JSON スキーマ（TuneOutput）は変更しない

## 手順

1. `hooks/tune-helper.ts` の `extractAllowCandidates(projectDir: string)` を実装する:

   **入力ファイル**: `~/.claude/gatekeeper-log.jsonl`（グローバル）

   **フィルタ条件**:
   - `tool === "Bash"`
   - `decision === "allow"`
   - `reason` フィールドが "静的ルール対象外" を含む（LLM 経路 = ユーザーが一度は許可したコマンド）
   - `timestamp` が過去 30 日以内

   **パターン抽出ロジック**:
   - `input_summary` フィールドからコマンドを取得する
   - `&&`・`||`・`;`・`\n` でコマンドを分割し、各部分を個別に処理する
   - 各部分をトリムし、先頭トークン（スペース区切り）を抽出する
   - 先頭トークンが以下の「メタコマンド」なら、第2トークンも含めてパターンとする:
     ```
     pnpm, npm, yarn, npx, uv, python, python3, node, tsx, ts-node,
     gh, git, docker, docker-compose, kubectl, terraform, aws, gcloud
     ```
   - それ以外は先頭トークンのみをパターンとする
   - パターンが `|` を含む場合はその前後を別コマンドとして再処理する

   **フィルタ**:
   - パターンが空文字・数字・`#` 始まりはスキップ
   - NEVER_AUTO_SUGGEST のいずれかの要素がパターンに含まれる（case-insensitive）ならスキップ
   - パターンが2文字未満はスキップ

   **集計・出力**:
   - パターンをキーにカウント
   - count 降順でソート
   - 上位 10 件を返す
   - `examples`: そのパターンにマッチした input_summary の先頭 80 文字を最大 3 件

2. `main()` から `extractAllowCandidates(projectDir)` を呼ぶように更新する

## 完了確認
- `tsx hooks/tune-helper.ts --project .` の出力で `allow_candidates` に1件以上の候補が入る
  （gatekeeper-log.jsonl が空の場合は 0 件でも OK）
