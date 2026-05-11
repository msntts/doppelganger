# gatekeeper アーキテクチャ説明

> **注記**: このファイルはコードから直接読み込まれない。
> 正式な実装は `gatekeeper.ts` にある。
> このファイルはアーキテクチャの人間向け説明版。

---

## アーキテクチャ概要

gatekeeper は **LLM が category を返し、TypeScript が allow/ask/block を決定する** 2 段階構造。

```
LLM (Haiku) → category のみ返す
TypeScript  → category → allow / ask / block にマッピング
```

LLM に allow/ask/block の最終決定権を持たせない理由:
- LLM は CLAUDE.md のワークフロールール（「コミット前に /review を呼べ」等）を訓練データから知っており、それを適用して非決定的な ask を返す
- セキュリティ判断には決定論が必要

---

## カテゴリ定義と GLOBAL_DECISION マップ

| category | 代表例 | デフォルト判定 |
|---|---|---|
| `readonly` | cat/grep/find、git status/diff/log、ls/ps | allow |
| `git_local` | git add、git commit（--amend なし） | allow |
| `git_remote` | git push、git fetch | ask |
| `external_write` | API POST/PUT/DELETE、clasp push/deploy | ask |
| `system_write` | ~/.ssh/・~/.aws/・/etc/ への書き込み | ask |
| `destructive` | rm -rf、DROP TABLE、git push --force | block |
| `uncertain` | 判断不能 | ask |

---

## 処理フロー

```
0.   ALWAYS_DENY（denied_patterns.json）→ 即 block
0.2  LLM CLI hard guard（機密参照あり）→ 即 ask
0.3  claude -p が hard guard 通過       → 即 allow
0.4  git add/commit（安全なもの）       → 即 allow
0.45 per-project allow_patterns.json    → 即 allow（Bash パターン単位）
0.5  debug/* ブランチ                   → 即 allow
1.   readonly_tools.json 登録済み       → 即 allow（ツール名単位）
2.   LLM 分類 → category
3.   category_overrides.json（プロジェクト）→ 決定を上書き
4.   GLOBAL_DECISION マップ             → allow / ask / block
```

---

## per-project カスタマイズ 3 層

各プロジェクトの `.claude/` ディレクトリに以下を置く。

### 1. `readonly_tools.json` — ツール名単位の静的 allow

```json
{ "tools": ["mcp__kot__get_current_overtime", "WebSearch"] }
```

- MCP ツールやビルトインツールをプロジェクト固有で allow するのに使う
- `NEVER_READONLY`（Bash/Edit/Write/Agent/Skill/Monitor）のツールは登録しても無視される

### 2. `allow_patterns.json` — Bash コマンドパターン単位の静的 allow

```json
{ "bash": ["clasp push", "clasp deploy"] }
```

- `category_overrides.json` より粒度が細かく、特定コマンドだけを allow したい場合に使う
- コマンド文字列の部分一致で判定（`"clasp push"` は `clasp push --force` にもマッチ）

### 3. `approval_policy.md` — LLM への分類ヒント（自然言語）

- LLM が迷うプロジェクト固有の操作に対してカテゴリを指示する
- 例: RPA プロジェクトで「フォーム送信は external_write、DOM 読み取りは readonly」
- allow/ask/block の指示を書かない（LLM は分類するだけで決定しない）

### 4. `category_overrides.json` — カテゴリ単位の決定オーバーライド

```json
{ "git_remote": "allow" }
```

- GLOBAL_DECISION を特定プロジェクトで上書きしたい場合
- `destructive`・`system_write` を `"allow"` に変更しようとしても無視される（`NEVER_OVERRIDE_TO_ALLOW`）

---

## NEVER_READONLY と NEVER_OVERRIDE_TO_ALLOW

| 定数 | 目的 |
|---|---|
| `NEVER_READONLY` | Bash/Edit/Write 等の副作用ツールが readonly_tools.json に誤登録されても無効化 |
| `NEVER_OVERRIDE_TO_ALLOW` | destructive/system_write が category_overrides で allow に設定されても無効化 |
