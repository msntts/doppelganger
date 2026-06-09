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

## Phase 5: observer unclear 分類改善

**背景:**
analyze-observer の期間比較で、review スキル直後の post_ai ターン 62%（P2 では 50%）が `unclear` に分類されている。`classifyResponse()` は `text.length <= 30 && APPROVAL_RE` を満たす場合だけ `approval` にするが、「OK 続けて」など 30 文字超またはパターン外の短い承認フレーズは全て `unclear` に落ちる。これにより review スキルの実際の承認率が過小計測される。

advisor 指摘: `prompt_len < 20 → approval` の単純な長さルールは「完成した？」のような短い質問を誤分類する。末尾 `？` 除外でスコープを絞る。

- [ ] 5-1. `hooks/observer-prompt.ts:82` — `classifyResponse()` 呼び出しの直後に後処理ブランチを追加。`responseType` を `let` に変更し、`preceding?.skill === "review"` かつ `responseType === "unclear"` かつ `prompt.length < 20` かつ `!prompt.trimEnd().endsWith("？")` の場合に `responseType = "approval"` へ上書きする

---

## Phase 6: review_verdict emit 修正

**背景:**
observer-log.jsonl に `review_verdict` エントリが 333 件中わずか 2 件（2026-06-09 13:43〜13:45 の今日分のみ、値は `"green"`）。`skills/review/SKILL.md` Step 5 の `tsx ... review_verdict <VERDICT>` は `<VERDICT>` がプレースホルダのままで、Claude が渡す文字列が不定（"green" 等の独自解釈になる）またはステップ自体をスキップするケースがある。`~/.claude/skills` → `doppelganger/skills` のシンボリックリンク経由なので doppelganger 側を修正すれば即反映。

advisor 指摘: IPC バス移行は不要（Bash 経由の log-observer.ts は機能している）。`<VERDICT>` の曖昧性と「スキップ可能に見える」書き方が問題。

- [ ] 6-1. `skills/review/SKILL.md` Step 5 を書き替え。`<VERDICT>` プレースホルダを除去し、判定ごとに実行するコマンドを明示した 3 ブロックに展開する。ヘッダーに「必ず実行すること」と記載し、Step 6（判定後の自律継続）より前に配置されていることを強調する

---

## Phase 7: CLAUDE.md デバッグ仮説ルール追加

**背景:**
Wrong Approach 摩擦が P1→P2 で 5→7 件に増加（期間は P1=24 日、P2=5 日のため rate 換算で 0.21→1.4 件/日と急増。ただしサンプルが少なく確定的ではない）。login hang 誤診断、OAuth vs storageState 誤仮定など MCP/ブラウザ自動化タスクでの初期診断ミスが観測されている。insights の「Diagnose before patching」推奨とも一致。

- [ ] 7-1. `CLAUDE.md`（`~/.claude/CLAUDE.md` シンボリックリンク先）に「デバッグ方針」セクションを追加。「不確かさとリスク判断」セクションの直後に配置。内容: MCP サーバー・ブラウザ自動化・外部 API の不具合調査時は仮説を 2〜3 個列挙して根拠を示してからコードを変更する、盲目的リトライ禁止

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
