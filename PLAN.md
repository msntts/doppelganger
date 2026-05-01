# claude-helm → doppelganger 統合 - Implementation Plan

## プロジェクト概要
claude-helm の機能を doppelganger に移植し、doppelganger を唯一の Claude Code 設定リポジトリに統合する。

## 環境
- macOS（メイン）/ Windows / Linux（マルチOS対応）
- TypeScript (tsx) — hooks の実装言語
- Claude Code harness (hooks + skills)

## 受け入れ条件
- doppelganger install.sh 実行後、すべての hooks・skills・CLAUDE.md が ~/.claude/ に正しく配置される
- gatekeeper.ts が denied_patterns・readonly_tools 自動学習・approval_policy・ask 判定を持つ
- caffeinate（macOS専用、platform ガード付き）が start/stop hook として動作する
- settings.json が doppelganger リポジトリで管理され、install.sh で配置される
- claude-helm を Archive 済みとして最終コミットできる

---

## 🔥 Hotfix（最優先）

<!-- 未完了なし -->

---

## Phase 0: CLAUDE.md マージ（最優先）

- [x] 0-1. 現 ~/.claude/CLAUDE.md の内容（リクエスト構造化・承認ポリシー編集ルール・PII禁止判断軸）と doppelganger/CLAUDE.md（自律性・フォーマット・コミット・スタイル・advisor/review 起動条件）を統合した新 CLAUDE.md を doppelganger/CLAUDE.md として作成する

## Phase 1: gatekeeper.ts 機能拡張

- [x] 1-1. `hooks/denied_patterns.json` を作成し、gatekeeper.ts に ALWAYS_DENY チェック（グローバル + プロジェクト .claude/ マージ）を追加する
- [x] 1-2. `hooks/approval_policy.md` を claude-helm から移植し、gatekeeper.ts でグローバル + プロジェクト .claude/ をマージして LLM に渡すよう変更する
- [x] 1-3. `readonly_tools.json` 自動学習を追加する（LLM が `learn: true` を返したら .claude/readonly_tools.json に永続化）
- [x] 1-4. `permissionDecision: "ask"` 出力を追加する（現状 block→stderr のみ）
- [x] 1-5. hardcoded READONLY_TOOLS を .claude/readonly_tools.json に移行し、doppelganger の readonly_tools.json をマージした内容で初期化する

## Phase 2: hooks 追加

- [x] 2-1. `hooks/caffeinate.ts` を作成する（UserPromptSubmit で caffeinate 起動、Stop で終了、darwin のみ動作）
- [x] 2-2. `hooks/remind-toolsearch.ts` を作成する（MCP ツール呼び出し前に ToolSearch 確認を促す）
- [x] 2-3. `hooks/work-logger.ts` にログローテーションを追加する（500KB / 2世代）

## Phase 3: skills 整理

- [x] 3-1. execute/SKILL.md に plunk-code の差分（フォーマッター詳細・debug ブランチ命名規則）を吸収する
- [x] 3-2. allow/SKILL.md のログパス参照が gatekeeper-log.jsonl を向いているか確認・修正する

## Phase 4: settings.json & install.sh 整備

- [x] 4-1. `settings.json` を doppelganger リポジトリで管理する（hooks を `~/.claude/hooks/` 経由で参照）
- [x] 4-2. `install.sh` に settings.json 配置と tsx 導入確認を追加する
- [x] 4-3. `package.json` に tsx を devDependency として追加し、install.sh で `npm install` を実行する

## Phase 5: claude-helm 店じまい

- [x] 5-1. claude-helm の README.md に Archive 通知を追記して最終コミットする

---

## メモ・決定事項
- hooks の実装言語は TypeScript（multi-OS 要件のため Python/Homebrew パスに依存しない）
- caffeinate は macOS 専用機能のため `process.platform === 'darwin'` でガード
- settings.json の hooks パスは `~/.claude/hooks/` 経由（install.sh でシンボリックリンク済み）
- plunk-code スキルは execute + investigate に統合済みのため廃止
- gatekeeper-log.jsonl のローテーション: 10MB / 1世代（auto_approve.py の 500KB/2世代より大きいが単純）

## 完了済みフェーズ
<!-- Phase {N}: {フェーズ名} `{開始ハッシュ}..{終了ハッシュ}` -->
