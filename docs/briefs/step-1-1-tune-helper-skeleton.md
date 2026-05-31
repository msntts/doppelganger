# Step 1-1: hooks/tune-helper.ts スケルトン + NEVER_AUTO_SUGGEST

## 前提条件
- `hooks/` ディレクトリが存在すること
- 既存の hooks/*.ts と同じ TypeScript/tsx スタックを使うこと

## 制約（触らないもの）
- 既存の hooks/*.ts は変更しない
- package.json は変更しない

## 手順

1. `hooks/tune-helper.ts` を新規作成する。内容は以下のとおり：
   - shebang: `#!/usr/bin/env tsx`
   - `NEVER_AUTO_SUGGEST` 配列を定義する（以下のパターンを含める）:
     ```
     "rm", "rmdir", "del", "Remove-Item",
     "curl", "wget",
     "chmod", "chown", "sudo", "su",
     "| sh", "| bash", "| pwsh", "| powershell",
     "DROP", "DELETE FROM", "TRUNCATE",
     "--force", "--hard", "-rf", "-fr",
     "mkfs", "format"
     ```
   - 出力 JSON の型を定義する:
     ```typescript
     interface PatternCandidate {
       pattern: string;
       count: number;
       examples: string[]; // 最大3件
     }
     interface TuneOutput {
       allow_candidates: PatternCandidate[];
       deny_candidates: PatternCandidate[];
     }
     ```
   - CLI 引数パース: `--project <path>` を `process.argv` から取得。未指定なら `process.cwd()` を使う
   - `extractAllowCandidates()` と `extractDenyCandidates()` のスタブを定義する（空配列を返す）
   - `main()`: スタブを呼び出し、`JSON.stringify(output)` を stdout に出力して終了
   - エラーは stderr に書いて exit 1

2. 動作確認コマンド（完了確認）:
   ```
   tsx hooks/tune-helper.ts --project .
   ```
   期待出力: `{"allow_candidates":[],"deny_candidates":[]}`

## 完了確認
- `tsx hooks/tune-helper.ts --project . 2>&1` が JSON を出力してエラーなく終了する
- `tsx hooks/tune-helper.ts` (--project なし) も同様に動作する
