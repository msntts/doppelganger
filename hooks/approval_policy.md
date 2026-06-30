# gatekeeper アーキテクチャ説明

> **注記**: このファイルはコードから直接読み込まれない。
> 正式な実装は `gatekeeper.ts` にある。
> このファイルはアーキテクチャの人間向け説明版。

---

## アーキテクチャ概要

承認フローは **1層構成**。gatekeeper.ts が静的判定し、決着しなかったものはダイアログへ委譲する。

```
PreToolUse → gatekeeper.ts (静的ルール) → allow / block
                     ↓ 決着しない場合は exit 0 で素通り
             PermissionRequest → ダイアログ（ユーザー承認）
```

優先順位: `permissions.allow` > `gatekeeper.ts` (PreToolUse) > ダイアログ

`/gatekeeper` スキルは廃止済み。

---

## 判定フロー

### Layer 1: gatekeeper.ts (PreToolUse, 静的ルール)

```
0.   denied_patterns（ALWAYS_DENY）→ 即ブロック
0.1  git add/commit（安全なもの）  → 即 allow
0.2  per-project allow_patterns.json → 即 allow（Bash パターン単位）
0.3  debug/* ブランチ              → 全操作を即 allow
1.   readonly_tools.json 登録済み  → 即 allow（ツール名単位）
2.   それ以外                      → exit 0（hookSpecificOutput を返さず PermissionRequest ダイアログへ）
```

### Layer 2: PermissionRequest (ダイアログ)

静的ルールで決着しなかった操作はユーザーへのダイアログで承認を求める。

---

## per-project カスタマイズ

各プロジェクトの `.claude/` ディレクトリに以下を置く。

### `denied_patterns.json` — 常時ブロック

```json
{
  "tools": ["Agent"],
  "bash_patterns": ["rm -rf /"]
}
```

- グローバル（`hooks/denied_patterns.json`）とマージされる
- `tools`: ツール名を指定すると問答無用でブロック
- `bash_patterns`: Bash コマンドへの部分一致でブロック

### `allow_patterns.json` — Bash コマンドの静的 allow

```json
{ "bash": ["clasp push", "clasp deploy"] }
```

- コマンド文字列への部分一致で allow
- `"clasp push"` は `clasp push --force` にもマッチ

### `readonly_tools.json` — ツール名の静的 allow

```json
{ "tools": ["mcp__kot__get_current_overtime", "WebSearch"] }
```

- 指定ツールへの呼び出しを即 allow する
- `NEVER_READONLY`（Bash / Edit / Write / NotebookEdit / Agent / Skill / Monitor）に登録されたツールは、ここに書いても無効化される

---

## NEVER_READONLY

副作用を持つツールが `readonly_tools.json` に誤登録されても無効化するガード。
現在の対象: `Bash`, `Edit`, `Write`, `NotebookEdit`, `Agent`, `Skill`, `Monitor`

新しい副作用ツールが追加された場合は `gatekeeper.ts` の `NEVER_READONLY` セットを更新すること。
