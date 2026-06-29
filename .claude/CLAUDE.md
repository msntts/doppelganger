# doppelganger プロジェクト

Claude Code のグローバル設定・スキル・フックを一元管理するホームリポジトリ。
新しいマシンでは `install.sh` を実行するだけで環境が再現される。

## シンボリックリンク構成

`install.sh` が以下のシンボリックリンクを `~/.claude/` に作成する：

| `~/.claude/` のエントリ | 実体                     |
| ----------------------- | ------------------------ |
| `CLAUDE.md`             | `doppelganger/CLAUDE.md` |
| `skills/`               | `doppelganger/skills/`   |
| `hooks/`                | `doppelganger/hooks/`    |
| `scripts/`              | `doppelganger/scripts/`  |

`settings.json` はシンボリックリンクにしない。`install.sh` が `doppelganger/settings.json` の内容を `~/.claude/settings.json` へ jq でマージする（Claude Code が settings.json を書き換えても他のキーが保持される）。

**`~/.claude/` を直接編集・git 操作しない。すべてこのリポジトリで行う。**

## ディレクトリ構成

```
doppelganger/
├── CLAUDE.md          # グローバル CLAUDE.md（~/.claude/CLAUDE.md の実体）
├── settings.json      # グローバル設定（hooks・permissions 等）install.sh でマージ
├── install.sh         # シンボリックリンク設定・settings.json マージスクリプト
├── package.json       # hooks の TypeScript 依存関係
├── skills/            # カスタムスキル（~/.claude/skills/ の実体）
│   ├── allow/         # 承認ポリシー注入スキル
│   ├── analyze-observer/  # observer ログ統合分析スキル
│   ├── execute/       # PLAN.md ベースの構造化実行スキル
│   ├── filetree/      # broot ファイルツリー表示スキル
│   ├── investigate/   # デバッグ調査スキル
│   ├── review/        # Security・DevOps レビュースキル
│   └── tune/          # allow/deny パターン学習スキル
├── hooks/             # フックスクリプト（~/.claude/hooks/ の実体）
│   ├── gatekeeper.ts        # PreToolUse: 静的ルールで allow/block 判定（PermissionRequest は type:prompt/Haiku に委譲）
│   ├── check-rm-safety.ts   # PreToolUse(Bash): rm コマンドの安全チェック
│   ├── work-logger.ts       # PostToolUse: 作業ログ記録
│   ├── observer-prompt.ts   # UserPromptSubmit: 判断帰属の分析・記録
│   ├── observer-skill.ts    # PreToolUse(Skill): スキル呼び出し記録
│   ├── observer-agent.ts    # PostToolUse(Agent): エージェント呼び出し記録
│   ├── observer-stop-prompt.ts  # Stop: 未消費 skill_start の提示
│   ├── observer-cleanup.ts  # Stop: event log のトリム
│   ├── caffeinate.ts        # UserPromptSubmit/Stop: セッション維持
│   ├── hook-io.ts           # stdin 読み取りユーティリティ（共通）
│   ├── archive-log.ts       # ログローテーション・追記ユーティリティ（共通）
│   ├── event-log.ts         # フック間 IPC バス（セッションスコープ JSONL）
│   ├── approval_policy.md   # gatekeeper アーキテクチャ説明（参照用）
│   └── denied_patterns.json # 常時ブロックパターン定義
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

hooks の登録は `settings.json` の `hooks` セクションで行う。各スクリプトの役割は各 `.ts` の冒頭コメントを正とする。
ログ: `~/.claude/gatekeeper-log.jsonl`（gatekeeper 判定）、`~/.claude/work-log.jsonl`（ツール実行）。

## NEVER_READONLY を最新に保つ

副作用を持つツールが `readonly_tools.json` に登録されても `gatekeeper.ts` の `NEVER_READONLY` が無効化する。新しい副作用ツールが追加されたら `NEVER_READONLY` も更新する。

`readonly_tools.json` は時々手で監査して意図しないエントリが混入していないか確認する。
