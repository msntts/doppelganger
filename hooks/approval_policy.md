# 自動承認ポリシー

このポリシーは、Claude Code が操作を実行する際に自動承認してよいかを判断するための基準です。

---

## 判断の2軸

操作を評価するときは、以下の2軸で考える。

### 軸1: 副作用の有無（read-only か否か）
- **read-only**: ファイルやシステムの状態を変えない操作
  - 例: ファイル読み取り、コマンド出力の確認、git log / diff / status
- **write / destructive**: 状態を変える操作
  - 例: ファイル編集・削除、git commit、パッケージインストール、API呼び出し

### 軸2: 回復可能性（git管理下か否か）
- **回復可能**: git で管理されているプロジェクト配下のファイルへの操作
  - **「git管理下」の定義**: git リポジトリのルート配下にあるファイルを指す。untracked（`git add` 前）であっても、`.git/` が存在するディレクトリ内のファイルはすべて git管理下とみなす
  - 理由: 変更は取り消せるため、破壊的に見えても許容できる
- **回復困難**: git 管理外（`~/.ssh/`、`~/.aws/`、`/etc/` 等）
  - 理由: 消したら戻らない

---

## 自動承認してよい操作

### read-only 操作（常に承認）
- ファイルの読み取り（cat / head / tail / grep / find 等）
- git 読み取りコマンド（status / log / diff / show / branch 等）
- コマンド出力の確認（ls / ps / env / which / df / du 等）
- Web の取得（fetch / curl の GET 等）

### write 操作 × 回復可能（承認寄り）
- git 管理下プロジェクト配下のファイル編集・作成・削除
- `git add` / `git commit`（ローカルコミット）/ `git push`（force なし）
- `~/.claude/` 配下の編集（settings.json を除く）
- テスト実行・ビルドコマンド
- **影響範囲がプロジェクト内に閉じるインストール・環境構築**
  - 理由: 変更がプロジェクトディレクトリ内（`node_modules/`・仮想環境等）に留まり、依存関係ファイル（`package.json`・`lock`・`requirements.txt` 等）が git で追跡されるため回復可能
  - 判断の目安: 「このコマンドが失敗・誤っても、プロジェクト外の環境は汚染されないか？」→ Yes なら承認
  - 要確認に倒す例: グローバルフラグ（`-g` / `--global` / `--system`）付き、`sudo` 経由のインストール、システム全体のランタイム変更（`nvm use` のグローバル切り替え等）

---

## 要確認（自動承認しない）操作

- **git push --force / --force-with-lease**: 履歴の強制書き換えは回復困難（通常の `git push` は承認）
- **プロジェクト外へのファイル書き込み**: `~/.ssh/`・`~/.aws/`・`/etc/` 等
- **`~/.claude/settings.json` の編集**: 権限・フック変更はユーザーが判断すべき
- **グローバル・システムへのパッケージインストール**: `-g` / `--global` / `--system` フラグ付き、`sudo` 経由、`brew install`（システム全体に影響）等
  - プロジェクト内に閉じるインストール（`pnpm install`・`npm install`・`pip install -r requirements.txt` 等、グローバルフラグなし）は「承認寄り」で扱う
- **外部サービスへの書き込み** (API の POST / PUT / DELETE 等)
- **プロセス管理** (`kill` / `pkill` 等)
- **cron の登録・削除**
- **環境変数の永続化** (`.env` 書き込み等)

---

## 判断基準のまとめ

| 副作用 | 回復可能性 | 判断 |
|--------|-----------|------|
| read-only | — | 承認（readonly_confidence: certain） |
| write | git管理下 | 承認寄り（readonly_confidence: probable） |
| write | git管理外 | 要確認（ask） |
| 不可逆・破壊的 | — | ブロック（block） |

迷ったら `ask`。明らかに危険な操作のみ `block`。
