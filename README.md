# doppelganger

Claude Code のグローバル設定・スキル・フックを一元管理するホームリポジトリ。
新しいマシンへの移行は `install.sh` 一発で完了する。

## このプロジェクトが解決する問題

Claude Code の設定（`~/.claude/`）はマシンごとに分散しがちで、設定変更の履歴が残らない。
このリポジトリで設定をバージョン管理し、シンボリックリンクで `~/.claude/` に投影することで：

- 設定変更を git で追跡できる
- 新マシンへの移行が1コマンドで完了する
- カスタムスキル・フックを共通基盤として育てられる

## 依存関係

| ツール | 用途 | インストール |
|---|---|---|
| Node.js 18+ | フック実行ランタイム | [nodejs.org](https://nodejs.org/) |
| pnpm | パッケージ管理 | `npm install -g pnpm` |
| tsx | TypeScript 実行 | `pnpm add -g tsx` |
| Claude Code | 本体 | [claude.ai/code](https://claude.ai/code) |

Windows の場合は「開発者モード」を有効にしてください（シンボリックリンク作成に必要）。

## インストール

### グローバル設定として使う（推奨）

```bash
git clone <this-repo> ~/doppelganger
cd ~/doppelganger
./install.sh
```

`install.sh` が以下のシンボリックリンクを `~/.claude/` に作成する：

| `~/.claude/` のエントリ | 実体 |
|---|---|
| `CLAUDE.md` | `doppelganger/CLAUDE.md` |
| `settings.json` | `doppelganger/settings.json` |
| `skills/` | `doppelganger/skills/` |
| `hooks/` | `doppelganger/hooks/` |

インストール後は Claude Code を再起動してください。

### プロジェクトローカルで使う

スキルだけ使いたい場合、`skills/` をプロジェクトの `.claude/skills/` にコピーするか、
個別の SKILL.md を参考に自プロジェクトへ取り込んでください。

## コンポーネント概要

### `CLAUDE.md` — グローバル行動指針

Claude の言語・自律性・コミット前チェック・ツール選択などを定義する。
`~/.claude/CLAUDE.md` として全プロジェクトに適用される。

### `settings.json` — フック設定

どのフックをどのイベントで起動するかを定義する。
フックの追加・削除はこのファイルを編集する。

### `hooks/` — 自動実行フック

| ファイル | 役割 |
|---|---|
| `gatekeeper.ts` | PreToolUse: 危険操作を静的ルールで判定、ログ記録 |
| `work-logger.ts` | PostToolUse: ファイル変更・Bash 実行をログ記録 |
| `observer-prompt.ts` | UserPromptSubmit: ユーザーの判断帰属を分析・記録 |
| `observer-skill.ts` | PreToolUse(Skill): スキル呼び出しを記録 |
| `observer-agent.ts` | PreToolUse(Agent): エージェント呼び出しを記録 |
| `caffeinate.ts` | セッション維持 |
| `remind-toolsearch.ts` | ToolSearch リマインダー |
| `event-log.ts` | フック間 IPC バス（セッションスコープ JSONL） |
| `tune-helper.ts` | `/tune` スキル用ログ分析ヘルパー |

ログは `~/.claude/` 以下に書き出される：
- `gatekeeper-log.jsonl` — gatekeeper 判定ログ
- `work-log.jsonl` — ツール実行ログ
- `observer-log.jsonl` — observer 分析ログ（長期アーカイブ）

### `skills/` — カスタムスキル

`/スキル名` で Claude Code から呼び出せるカスタムコマンド。

| スキル | 説明 |
|---|---|
| `/execute` | `PLAN.md` 経由の構造化タスク実行 |
| `/review` | Security + DevOps の2エージェントコードレビュー |
| `/investigate` | debug ブランチでの原因調査 |
| `/tune` | gatekeeper ログから allow/deny パターンを学習 |
| `/analyze-observer` | observer ログ + insights HTML の統合分析 |
| `/filetree` | broot ファイルツリー表示 |
| `/allow` | 承認ポリシーへのパターン追加 |
| `/gatekeeper` | ツール実行前の安全性自己評価 |

## スキルの追加

`skills/<name>/SKILL.md` を作成すると `/name` として自動認識される。
フロントマターに `name`, `description`, `user-invocable`, `allowed-tools` を記載する。

## gatekeeper について

`gatekeeper.ts` は静的ルールに基づいて操作をログ記録・判定するフック。
**完全な強制ではなく、ロギングと静的ブロックの組み合わせ**として機能する。
Claude が CLAUDE.md の指示に従って `/gatekeeper` スキルを自律呼び出しすることで安全性を補完する設計。

## `/tune` の使い方

ログが蓄積するほど候補精度が上がる。**インストール直後は候補が出ないのが正常**。
目安として 30 日以上使用してから実行する。

```bash
/tune
```

定期的（週1〜月1）に実行して allow/deny パターンを育てる。
