# gatekeeper カテゴリ分類アーキテクチャへのリファクタリング - Implementation Plan

## プロジェクト概要
gatekeeper の LLM 役割を「category を返すだけ」に縮小し、allow/ask/block の決定を TypeScript が担う。非決定的な ask 頻発を解消する。

## 環境
- macOS / TypeScript (tsx)
- Claude Code hooks (PreToolUse)

## 受け入れ条件
- `git diff | claude -p --no-session-persistence` が常に allow になる
- `git commit` が常に allow になる（review スキル呼び出し前でも）
- `clasp push` が rpa・kintai-kanri プロジェクトで allow になる
- LLM が allow/ask/block を直接返さず category を返す
- per-project `category_overrides.json` でカテゴリ単位の決定をオーバーライドできる

## 完了条件
- `npx tsx hooks/gatekeeper.ts` でコンパイルエラーなし
- gatekeeper に stdin で各パターンを流してログで decision を確認

---

## 🔥 Hotfix（最優先）

- [x] H-1. `loadCategoryOverrides` に `NEVER_OVERRIDE_TO_ALLOW` ガード追加（`destructive`・`system_write` への allow 上書きを禁止）
- [x] H-2. `git push`（force なし）挙動変更確認：旧 auto-approve → 新 `ask`（`GLOBAL_DECISION.git_remote = "ask"` の設計仕様。CLAUDE.md「push は明示指示のときのみ」と整合）
- [x] H-3. `allow_patterns.json` による Bash コマンドパターン単位の静的 allow 実装（`category_overrides.json` は category 単位で粒度が粗すぎるため）
  - `loadBashAllowPatterns(cwd)` 関数を追加し、main() の 0.4 直後（0.45）に挿入
  - kintai-kanri に `.claude/allow_patterns.json: {"bash": ["clasp push", "clasp deploy"]}` を作成
  - kintai-kanri の `category_overrides.json`（`external_write: allow`）は `{}` に無効化（物理削除は gatekeeper が rm をブロックするため保留）

---

## Phase 1: gatekeeper.ts コアリファクタリング [REVIEW]

- [x] 1-1. 型定義・定数を追加（Category 型・GLOBAL_DECISION マップ・新 Judgment 型・loadCategoryOverrides 関数）
- [x] 1-2. SYSTEM_PROMPT を「category のみ返す分類プロンプト」に書き換え → [詳細](docs/briefs/step-1-2-system-prompt.md)
- [x] 1-3. extractJson・judge 関数を新フォーマット対応に更新、learn/saveReadonlyTool を削除
- [x] 1-4. main() に新決定ロジックを組み込む（category_overrides → GLOBAL_DECISION の 2 段階）

## Phase 2: per-project 設定移行

- [x] 2-1. rpa: `approval_policy.md` を分類ヒントスタイルに書き直す（category_overrides.json は不要）
- [x] 2-2. kintai-kanri: `approval_policy.md` を分類ヒントスタイルに書き直す + `allow_patterns.json` 新設（`clasp push/deploy` を Bash パターン単位で allow）

## Phase 3: ドキュメント更新

- [x] 3-1. `hooks/approval_policy.md` を新アーキテクチャ説明に全面更新

---

## メモ・決定事項

### カテゴリ定義
| category | 意味 | デフォルト判定 |
|---|---|---|
| `readonly` | 読み取り専用 | allow |
| `git_local` | ローカル git 操作（add/commit） | allow |
| `git_remote` | git push / remote 通信 | ask |
| `external_write` | 外部 API 書き込み・clasp push など | ask |
| `system_write` | git 管理外（~/.ssh/ 等）への書き込み | ask |
| `destructive` | 不可逆破壊操作（rm -rf, DROP TABLE, force push） | block |
| `uncertain` | 判断不能 | ask |

### 処理フロー（変更後の main()）
```
0.  ALWAYS_DENY          → block
0.2 LLM CLI hard guard   → ask（機密参照あり）
0.3 claude -p 通過済み   → allow（先日追加、維持）
0.4 git add/commit 安全  → allow（先日追加、維持）
0.5 debug/* ブランチ     → allow
1.  readonly_tools.json  → allow（learn 機構は廃止）
2.  LLM 分類             → category（approval_policy.md はヒント）
3.  category_overrides   → 上書き（プロジェクト固有）
4.  GLOBAL_DECISION      → allow / ask / block
```

### per-project カスタマイズ 3 層
1. `readonly_tools.json` — ツール名単位の静的 allow（既存、変更なし）
2. `approval_policy.md` — LLM への分類ヒント（自然言語、継続利用。ただし「allow して」でなく「〇〇は external_write に分類せよ」スタイルに変更）
3. `category_overrides.json` — カテゴリ単位の決定オーバーライド（新設）

### learn 機構廃止理由
LLM が category を返すだけになるため learn フィールドが不要。
readonly_tools.json への手動追記で代替。

## 完了済みフェーズ
- Phase 0-5: claude-helm → doppelganger 統合 `d20eb86`（2026-05 完了済み）
