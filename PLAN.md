# doppelganger — 診断修正計画

## プロジェクト概要

アドバイザー診断で発見したバグ・ドキュメント乖離・コード軽微問題をすべて修正する。

## 環境

- Windows 11 / TypeScript, tsx
- hooks/ は `~/.claude/hooks/` にシンボリックリンクされてライブ実行される

## 受け入れ条件

- `gatekeeper.ts` が PermissionRequest イベントでも正しい形式を返す
- 旧 LLM アーキテクチャの残骸（approval_policy.md / allow スキル等）が現行実装と一致する
- README・CLAUDE.md のファイル一覧が実際のディレクトリと一致する

## 完了条件

- 各タスク後: `pnpm exec prettier --check hooks/ scripts/ skills/` でフォーマット確認
- gatekeeper.ts 修正後: allow/block ケースの JSON を stdin で流して出力確認

---

## 🔥 Hotfix（最優先）

<!-- 緊急対応はここに積む -->

---

## Phase 4: コード軽微修正

- [x] 4-1. `observer-prompt.ts` — `classifyResponse(prompt)` の重複呼び出し（L92 と L124）を変数化して1回に
- [ ] 4-2. `scripts/log-observer.ts` — `appendArchive` 使用に統一してローテーションを追加
- [ ] 4-3. `check-rm-safety.ts` — Windows の `/tmp` を OS の `tmpdir()` で補完する
- [ ] 4-4. `PLAN.md` — 旧リファクタ計画（全タスク完了済み）を削除し本ファイルのみにする

---

## メモ・決定事項

- `caffeinate.ts` の Windows での無操作起動はオーバーヘッドが軽微なため放置（Mac 移行時に有効になる）
- `observer-skill.ts` / `observer-agent.ts` の冗長な tool_name チェックはサニティチェックとして残す
- `settings.json` の PermissionRequest 登録は有効（PreToolUse で全 allow でも PermissionRequest は発火する）
- Phase 2 は [REVIEW] マーク付き（旧アーキテクチャ除去で意図せず機能を削らないか確認）

## 完了済みフェーズ

- Phase 1: バグ修正 `44b7635..f4d6afd`
- Phase 2: 旧 LLM アーキテクチャ残骸の除去 `f4d6afd..ea6512e`
- Phase 3: README・プロジェクト CLAUDE.md 更新 `39d2d56..b90ae27`
