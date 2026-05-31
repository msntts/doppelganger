# Step 1-4: tune-skip.json と既存 JSON による重複除外

## 前提条件
- `extractAllowCandidates` と `extractDenyCandidates` が実装済みであること（1-2・1-3 完了後）

## 制約（触らないもの）
- 抽出ロジック自体（1-2・1-3 の実装）は変更しない

## 手順

1. `hooks/tune-helper.ts` に以下の補助関数を追加する:

   **`loadSkipList(): Set<string>`**
   - `~/.claude/tune-skip.json` を読み込む
   - 形式: `{ "patterns": ["pattern1", "pattern2", ...] }`
   - ファイルが存在しない場合は空の Set を返す（エラーにしない）

   **`loadExistingAllowPatterns(projectDir: string): Set<string>`**
   - `<projectDir>/.claude/allow_patterns.json` を読み込む
   - 形式: `{ "bash": ["pattern1", ...] }`
   - ファイルが存在しない場合は空の Set を返す

   **`loadExistingDenyPatterns(projectDir: string): Set<string>`**
   - `<projectDir>/.claude/denied_patterns.json` を読み込む
   - 形式: `{ "tools": [], "bash_patterns": ["pattern1", ...] }`
   - ファイルが存在しない場合は空の Set を返す

2. `main()` を更新する:
   - 候補抽出後、上記3つの Set に含まれるパターンを `allow_candidates` と `deny_candidates` からそれぞれ除外する
   - 除外判定は完全一致（`Set.has(pattern)`）
   - 除外後に count 0 件になった候補リストは `"candidates_filtered_count"` フィールドで件数だけ出力する（デバッグ用）

3. 出力 JSON スキーマを更新する（`TuneOutput` に追加）:
   ```typescript
   interface TuneOutput {
     allow_candidates: PatternCandidate[];
     deny_candidates: PatternCandidate[];
     skipped_count: number; // skip/既登録で除外した候補の合計件数
   }
   ```

## 完了確認
- `tsx hooks/tune-helper.ts --project .` の出力に `skipped_count` フィールドが含まれる
- `.claude/allow_patterns.json` に既存パターンがあれば、それが allow_candidates から除外されていること
