# Step 1-3: deny 候補抽出ロジック

## 前提条件
- `hooks/tune-helper.ts` が存在し、`extractDenyCandidates` スタブが定義されていること（1-1 完了後）

## 制約（触らないもの）
- `extractAllowCandidates` の実装は変更しない
- NEVER_AUTO_SUGGEST リストは変更しない

## 手順

1. `hooks/tune-helper.ts` に `extractDenyCandidates(projectDir: string)` を実装する:

   **入力ファイル**:
   - `~/.claude/observer-log.jsonl` — 拒否シグナル
   - `~/.claude/work-log.jsonl` — 直前に実行されたコマンド

   **observer-log からの rejection 抽出**:
   - `response_type === "rejection"` のエントリを収集
   - `timestamp` が過去 30 日以内に絞る
   - 各エントリから `session_id` と `timestamp`（ISO 文字列→Date オブジェクト）を取得

   **work-log との相関**:
   - `work-log.jsonl` を全行読み込み、`tool === "Bash"` のエントリだけ保持
   - 各 rejection エントリに対し、以下の条件に一致する work-log エントリを探す:
     - `session_id` が一致
     - work-log の `timestamp` が rejection の 0〜300 秒前（5分以内）
   - 見つかった `command` フィールド（最大 300 文字）がデニー候補のコマンド

   **パターン抽出**:
   - allow 候補と同じロジックでパターンを抽出（先頭1〜2トークン）
   - NEVER_AUTO_SUGGEST に含まれるパターンはスキップ
   - `git add`・`git commit` は安全なので除外
   - 同一パターンのカウントと examples を収集

   **集計・出力**:
   - count 降順でソート
   - 上位 5 件を返す
   - allow_candidates と deny_candidates でパターンが重複する場合、deny 側から除外する（安全側に倒す）

2. `main()` から `extractDenyCandidates(projectDir)` を呼ぶように更新する

## 完了確認
- `tsx hooks/tune-helper.ts --project .` が `deny_candidates` フィールドを含む JSON を返す
  （observer-log が空または rejection がない場合は空配列でも OK）
