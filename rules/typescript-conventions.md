---
description: TypeScript/JavaScript プロジェクトのフォーマット・リント・コミット前チェック規約
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.mjs"
---

## フォーマット・リント

- フォーマッター: `prettier`（`pnpm exec prettier --write .`）
- リンター: `eslint`（`pnpm run lint`）
- 設定ファイルが存在する場合のみ実行する

## コミット前チェック

1. `pnpm run build`（または `tsc --noEmit`）でコンパイルエラーなし → **必須**
2. `pnpm run lint` でリントエラーなし
3. `pnpm-lock.yaml` をステージ済みにする

lockfile（`pnpm-lock.yaml`）は必ずコミットする。`.gitignore` で除外しない。

## パッケージマネージャ

- **pnpm** を使う（npm / yarn は使わない）
- `pnpm install` / `pnpm add <pkg>` / `pnpm run <script>`
- lockfile が `package-lock.json` / `yarn.lock` のみの場合はユーザーに pnpm 移行を確認する
