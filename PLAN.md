# doppelganger /tune skill — Implementation Plan

## プロジェクト概要
observer・gatekeeper ログから allow/deny パターン候補を抽出し、ユーザー確認後に `.claude/` 設定ファイルへ書き込む `/tune` スキルを実装する。

## 環境
- Windows 11 / TypeScript, tsx（既存 hooks と同スタック）
- 入力: `~/.claude/gatekeeper-log.jsonl`・`~/.claude/observer-log.jsonl`・`~/.claude/work-log.jsonl`
- 出力: `.claude/allow_patterns.json`・`.claude/denied_patterns.json`（project-local）・`~/.claude/tune-skip.json`（global）

## 操作仕様
- `/tune` を呼ぶと過去 30 日の候補リストを表示する
- ユーザーが番号で選んだものだけが project-local `.claude/*.json` に追記される
- 却下（skip）した候補は `~/.claude/tune-skip.json` に記録され次回から除外される
- `NEVER_AUTO_SUGGEST` リストに含まれるパターンは候補に出ない

## 受け入れ条件
- `/tune` を呼ぶと allow 候補・deny 候補が表示される（ログが空の場合は「候補なし」で正常終了）
- 番号選択後、対象 JSON が正しく更新されコミットされる
- skip した候補が次回実行で出てこない
- `rm`・`curl | sh` 等の危険パターンが候補に出ない

## 完了条件
- `tsx hooks/tune-helper.ts --project . 2>/dev/null` が JSON を stdout に出力する
- `/tune` を手動実行して end-to-end が通る

---

## 🔥 Hotfix（最優先）

<!-- 動作確認中の不具合・緊急対応はここに積む。未完了がある限り最優先で対応する -->

---

## Phase 1: tune-helper.ts — JSONL 集計・候補抽出

- [x] 1-1. `hooks/tune-helper.ts` スケルトン + NEVER_AUTO_SUGGEST 定義 → [詳細](docs/briefs/step-1-1-tune-helper-skeleton.md)
- [x] 1-2. allow 候補抽出ロジック（gatekeeper-log.jsonl から LLM 経路 Bash を集計）→ [詳細](docs/briefs/step-1-2-allow-candidates.md)
- [x] 1-3. deny 候補抽出ロジック（observer rejection × work-log 相関）→ [詳細](docs/briefs/step-1-3-deny-candidates.md)
- [ ] 1-4. tune-skip.json と既存 JSON による重複除外 → [詳細](docs/briefs/step-1-4-dedup.md)

## Phase 2: skills/tune/SKILL.md — フロー制御 [REVIEW]

- [ ] 2-1. `skills/tune/SKILL.md` フロントマター + 候補表示・番号選択フォーマット定義
- [ ] 2-2. JSON 書き込み手順（allow_patterns.json・denied_patterns.json の作成/更新）
- [ ] 2-3. tune-skip.json 更新 + 自動 git commit 手順

## Phase 3: 文書化

- [ ] 3-1. `CLAUDE.md` に `/tune` の位置づけ追記（`fewer-permission-prompts` との使い分け含む）

---

## メモ・決定事項
- helper script は `hooks/tune-helper.ts`（他 hooks と同ディレクトリで一元管理）
- allow 候補の信号源: `gatekeeper-log.jsonl` の `tool=Bash`, `decision=allow`, reason に "静的ルール対象外" を含むエントリ
- deny 候補の信号源: `observer-log.jsonl` の `response_type=rejection` × `work-log.jsonl` の同セッション5分前以内の Bash コマンドの相関
- allow_patterns.json フォーマット: `{ "bash": ["pattern1", ...] }`
- denied_patterns.json フォーマット: `{ "tools": [], "bash_patterns": ["pattern1", ...] }`
- 書き込み先は project-local `.claude/`（`~/.claude/` には書かない）
- `fewer-permission-prompts` スキル（settings.json permissions.allow）とは別系統。deny 提案に独自価値がある

## 完了済みフェーズ
<!-- Phase {N}: {フェーズ名} `{開始ハッシュ}..{終了ハッシュ}` -->
