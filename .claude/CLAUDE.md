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
| `scripts/` | `doppelganger/scripts/` |

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
├── hooks/             # フックスクリプト（~/.claude/hooks/ の実体）
│   ├── gatekeeper.ts       # ツール実行の承認制御
│   ├── work-logger.ts      # 作業ログ記録
│   ├── caffeinate.ts       # セッション維持
│   ├── approval_policy.md  # 承認ポリシー定義
│   └── denied_patterns.json # 拒否パターン定義
└── scripts/           # スキルから呼ばれる CLI スクリプト（~/.claude/scripts/ の実体）
    └── log-observer.ts     # observer-log.jsonl への追記
```

## スキルの追加・変更

`skills/<name>/SKILL.md` を作成する。Claude Code が自動的に `/name` として認識する。

## hooks/ の編集規約

- TypeScript で書く（`tsx` 実行、依存は package.json）
- 外部入力は型ガードを通す
- **fail-open**: hook 障害でユーザー操作を止めない方向に倒す
- 動作確認は hook 入力 JSON を stdin に流し込む

## skills/ 追加時のフォーマット

- ディレクトリ形式 `skills/<name>/SKILL.md`（フラット `*.md` は使わない）
- フロントマターに `name` / `description` / `user-invocable` / `allowed-tools` を書く
- description は **ユーザーが実際にどう言うか** を含める。自然な言い回しを列挙すると auto-trigger に効く
- body は手順だけ簡潔に。前置きは書かない
- 動作確認は `/skill-creator` の eval 機構

## hooks の概要

各 hook の役割は `settings.json` と各 `.ts` の冒頭コメントを正とする。
ログ: `~/.claude/gatekeeper-log.jsonl`（gatekeeper 判定）、`~/.claude/work-log.jsonl`（ツール実行）。

## gatekeeper の learn を信用しすぎない

LLM が `learn: true` を返しても、副作用を持ちうるツールは `gatekeeper.ts` の `NEVER_READONLY` で弾いている。新しい副作用ツールが追加されたら NEVER_READONLY も更新する。

`readonly_tools.json` は時々手で監査する（過去に副作用ツールが誤学習された事故あり）。
