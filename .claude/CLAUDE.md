# doppelganger プロジェクト

Claude Code のグローバル設定・スキル・フックを一元管理するホームリポジトリ。
新しいマシンでは `install.sh` を実行するだけで環境が再現される。

## シンボリックリンク構成

`install.sh` が以下のシンボリックリンクを `~/.claude/` に作成する：

| `~/.claude/` のエントリ | 実体 |
|---|---|
| `CLAUDE.md` | `doppelganger/CLAUDE.md` |
| `settings.json` | `doppelganger/settings.json` |
| `skills/` | `doppelganger/skills/` |
| `hooks/` | `doppelganger/hooks/` |

**`~/.claude/` を直接編集・git 操作しない。すべてこのリポジトリで行う。**

## ディレクトリ構成

```
doppelganger/
├── CLAUDE.md          # グローバル CLAUDE.md（~/.claude/CLAUDE.md の実体）
├── settings.json      # グローバル設定（permissions・hooks の定義）
├── install.sh         # シンボリックリンク設定スクリプト
├── package.json       # hooks の TypeScript 依存関係
├── skills/            # カスタムスキル（~/.claude/skills/ の実体）
│   ├── allow/         # 承認ポリシー注入スキル
│   ├── execute/       # PLAN.md ベースの構造化実行スキル
│   ├── filetree/      # broot ファイルツリー表示スキル
│   ├── investigate/   # デバッグ調査スキル
│   └── review/        # Security・DevOps レビュースキル
└── hooks/             # フックスクリプト（~/.claude/hooks/ の実体）
    ├── gatekeeper.ts       # ツール実行の承認制御
    ├── work-logger.ts      # 作業ログ記録
    ├── caffeinate.ts       # セッション維持
    ├── remind-toolsearch.ts # ToolSearch リマインダー
    ├── approval_policy.md  # 承認ポリシー定義
    └── denied_patterns.json # 拒否パターン定義
```

## スキルの追加・変更

`skills/<name>/SKILL.md` を作成する。Claude Code が自動的に `/name` として認識する。

## hooks/ の編集規約

- TypeScript で書き、`tsx` で実行する（依存は package.json）
- stdin から JSON 入力を受ける。`process.stdin` async iterator で全部読み切る
- パース後は型ガードを通す（null/配列/プリミティブ型の混入を弾く）。gatekeeper.ts の `extractJson` を参考にする
- **fail-open**: 例外時は明示的に allow を返す（`process.exit(0)` で済ませず `allow()` 呼び出し）。hook 障害でユーザー操作を止めないこと
- 動作確認: `echo '{...}' | tsx hooks/<name>.ts` で stdin を流し込む

## skills/ 追加時のフォーマット

- ディレクトリ形式: `skills/<name>/SKILL.md`（フラットな `*.md` は使わない）
- フロントマター必須:
  ```yaml
  ---
  name: <slash command 名>
  description: <ユーザーが実際にどう言うかを日本語で列挙。auto-trigger に効く>
  user-invocable: true
  allowed-tools:  # 絞る場合
    - Read
    - Bash
  ---
  ```
- description には「〜したい」「なんか動かない」等の自然な言い回しを含める
- body は手順だけ簡潔に。哲学的な前置きは書かない
- 動作確認: `/skill-creator`（anthropic-agent-skills プラグイン）の eval 機構

## hook 役割マップ

| hook | event | 役割 |
|---|---|---|
| gatekeeper.ts | PreToolUse | LLM 判定で allow/ask/deny。readonly_tools・denied_patterns・approval_policy で短絡判定 |
| work-logger.ts | PostToolUse | ツール実行を `~/.claude/work-log.jsonl` に記録（Write/Edit/Bash のみ） |
| caffeinate.ts | UserPromptSubmit / Stop | macOS スリープ抑制（darwin 以外は no-op） |
| remind-toolsearch.ts | PreToolUse (matcher: `mcp__.*`) | MCP 呼び出し前に ToolSearch でのスキーマ取得を促す |

ログ:
- `~/.claude/gatekeeper-log.jsonl` — gatekeeper の判定ログ
- `~/.claude/work-log.jsonl` — work-logger のツール実行ログ

## gatekeeper の learn を信用しすぎない

LLM が `learn: true` を返しても、副作用を持ちうるツール（`Bash` / `Edit` / `Write` / `NotebookEdit` / `Agent` / `Skill`）は `NEVER_READONLY` 定数で弾いている。`readonly_tools.json` は時々手で監査する。

過去の事故: Bash・Agent・Skill が誤学習され、全 Bash 呼び出しが `readonly_tools に登録済みのため自動承認` で無条件 allow された。`f7513e063`・`c298ca8`・`62b60eb` で対処済み。

## install.sh の挙動

- 既存の `~/.claude/{CLAUDE.md,settings.json,skills,hooks}` を `.bak` にバックアップしてからシンボリックリンクを張る
- `tsx` が PATH にない場合は `npm install -g tsx` を促してエラー終了
- `npm install` を実行（hook の TypeScript 依存）
- Windows: 開発者モードを有効化してから実行
