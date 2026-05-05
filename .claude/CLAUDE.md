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
