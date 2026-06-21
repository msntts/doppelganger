---
description: Python プロジェクトのフォーマット・リント・コミット前チェック規約
paths:
  - "**/*.py"
  - "**/pyproject.toml"
  - "**/uv.lock"
---

## フォーマット・リント

- フォーマッター: `ruff format`（`uv run ruff format .`）
- リンター: `ruff check`（`uv run ruff check .`）
- 設定ファイル（`pyproject.toml`）が存在する場合のみ実行する

## コミット前チェック

1. `uv run ruff check` でリントエラーなし → **必須**
2. `uv run mypy` で型エラーなし → 推奨（設定がある場合）
3. `uv.lock` をステージ済みにする

lockfile（`uv.lock`）は必ずコミットする。`.gitignore` で除外しない。

## パッケージマネージャ・ランタイム

- **uv** を使う（pip / poetry / pipenv は使わない）
- 依存追加: `uv add <pkg>`
- スクリプト実行: `uv run <script>`（venv を手動 activate しない）
- 仮想環境は uv が自動管理。`python -m venv` / `source .venv/bin/activate` は書かない
