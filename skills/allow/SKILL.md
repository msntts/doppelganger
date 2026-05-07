---
name: allow
description: 承認ルールをプロジェクトの .claude/approval_policy.md に追記して gatekeeper の ask 判定を減らす。「〜を許可してほしい」「〜を自動承認に」「いちいち聞かないで」「ask が多い」「承認スキップしたい」「/allow [何を許可するか]」等で使う。
---

# /allow [何を許可するか]

現在のプロジェクトの `.claude/approval_policy.md` に承認ルールを追記し、
以降の gatekeeper LLM 判定で同種操作が自動承認されるようにする。

infrastructure は揃っている：`gatekeeper.ts` はグローバルシステムプロンプトと
プロジェクトポリシーをマージして LLM に渡す。
このコマンドは「何をプロジェクトポリシーに書くか」を整理して注入するだけでよい。

---

## フロー

### Step 1: 直近の ask パターンを収集（コンテキスト把握）

```bash
python3 -c "
import json
from pathlib import Path

log = Path.home() / '.claude' / 'gatekeeper-log.jsonl'
if not log.exists():
    print('(ログなし)')
    exit(0)

asks = []
with log.open() as f:
    for line in f:
        try:
            d = json.loads(line)
            if d.get('decision') == 'ask':
                asks.append(d)
        except Exception:
            pass

if not asks:
    print('(ask 判定なし)')
    exit(0)

print(f'直近の ask 判定（最新 20 件）:')
for d in asks[-20:]:
    ts = d.get('timestamp','')
    summary = d.get('input_summary','')
    interp = d.get('interpretation','')
    reason = d.get('reason','')
    print(f'  [{ts}] {summary}')
    if interp:
        print(f'    interpretation: {interp}')
    if reason:
        print(f'    reason: {reason}')
"
```

### Step 2: 意図の確認

- **引数あり**（例: `/allow npm publish と deploy 操作`）
  → その内容を許可対象として解釈する。Step 3 へ進む。
- **引数なし**
  → Step 1 のログを見せて「何を許可しますか？」と確認する。

### Step 3: プロジェクトルートの特定

```bash
git rev-parse --show-toplevel
```

### Step 4: 既存のプロジェクトポリシーを確認

`{git_root}/.claude/approval_policy.md` を Read する。
存在しなければ新規作成する。

### Step 5: ルールの生成と注入

ユーザーの意図を自然言語のポリシールールに整形して追記する。

**整形の指針：**
- **何を** 許可するか（コマンド名・操作種別）を具体的に書く
- **なぜ** 許可するか（このプロジェクトでの用途）を添える
- グローバルポリシー（gatekeeper.ts の SYSTEM_PROMPT）で「要確認」とされている操作を上書きする場合は
  「グローバルポリシーより優先して承認する」と明示する
- `--force` 系や不可逆な削除は許可範囲を慎重に定義する
- 認証情報を読み取って外部送信するコマンドは一括許可を避ける

**書き方の例（Google Apps Script 開発プロジェクト）：**

```markdown
## 追加承認: Google Apps Script 開発操作

このプロジェクトは Google Apps Script を clasp で開発するリポジトリ。
以下の clasp 操作は開発サイクルの通常操作として自動承認する
（グローバルポリシーの「外部サービスへの書き込みは要確認」より優先）。

- `clasp push` / `clasp push --force`
  - 理由: ローカルコードを GAS クラウドに同期する通常操作。ユーザーが意図的に実行する
- `clasp deploy` / `clasp deploy --deploymentId ... --description ...`
  - 理由: 同上
```

### Step 6: 変更内容の確認

追記した内容を表示し、
「次回から該当操作は gatekeeper で自動承認されます」と伝える。

---

## 注意事項

- `~/.claude/settings.json` の編集はグローバルポリシーで「要確認」に固定されているため、
  このコマンドでは承認範囲に含めない
- ルールを削除・絞り込みたい場合は直接 `.claude/approval_policy.md` を編集する
