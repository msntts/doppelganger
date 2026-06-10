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

## Phase 7: CLAUDE.md デバッグ仮説ルール追加

**背景:**
Wrong Approach 摩擦が P1→P2 で 5→7 件に増加（期間は P1=24 日、P2=5 日のため rate 換算で 0.21→1.4 件/日と急増。ただしサンプルが少なく確定的ではない）。login hang 誤診断、OAuth vs storageState 誤仮定など MCP/ブラウザ自動化タスクでの初期診断ミスが観測されている。insights の「Diagnose before patching」推奨とも一致。

- [x] 7-1. `CLAUDE.md`（`~/.claude/CLAUDE.md` シンボリックリンク先）に「デバッグ方針」セクションを追加。「不確かさとリスク判断」セクションの直後に配置。内容: MCP サーバー・ブラウザ自動化・外部 API の不具合調査時は仮説を 2〜3 個列挙して根拠を示してからコードを変更する、盲目的リトライ禁止

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
- Phase 4: コード軽微修正 `b90ae27..477e1f3`
- Phase 5: observer unclear 分類改善 `2ec4681..b27ba7a`
- Phase 6: review_verdict emit 修正 `b27ba7a..e5d58c2`
