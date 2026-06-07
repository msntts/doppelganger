---
name: allow
description: 承認ルールをプロジェクトの .claude/allow_patterns.json または readonly_tools.json に追記して gatekeeper の静的許可リストを拡張する。「〜を許可してほしい」「〜を自動承認に」「いちいち聞かないで」「承認スキップしたい」「/allow [何を許可するか]」等で使う。
---

# /allow [何を許可するか]

現在のプロジェクトの `.claude/allow_patterns.json`（Bash コマンド）または
`.claude/readonly_tools.json`（ツール名）に許可エントリを追記し、
以降の gatekeeper 静的チェックで同種操作が即 allow されるようにする。

gatekeeper.ts は LLM を呼ばない。Bash パターンとツール名を JSON で管理する。

---

## フロー

### Step 1: 意図の確認

- **引数あり**（例: `/allow npm publish と deploy 操作`）
  → その内容を許可対象として解釈する。Step 2 へ進む。
- **引数なし**
  → 直近の gatekeeper ログを確認して候補を提示する。

```bash
python3 -c "
import json
from pathlib import Path

log = Path.home() / '.claude' / 'gatekeeper-log.jsonl'
if not log.exists():
    print('(ログなし)')
    exit(0)

candidates = []
with log.open() as f:
    for line in f:
        try:
            d = json.loads(line)
            if '静的ルール対象外' in d.get('reason', ''):
                candidates.append(d)
        except Exception:
            pass

if not candidates:
    print('(候補なし)')
    exit(0)

print('直近の「静的ルール対象外 → allow」判定（最新 20 件）:')
for d in candidates[-20:]:
    ts = d.get('timestamp','')
    summary = d.get('input_summary','')
    tool = d.get('tool','')
    print(f'  [{ts}] {tool}: {summary}')
"
```

### Step 2: プロジェクトルートの特定

```bash
git rev-parse --show-toplevel
```

### Step 3: 許可対象の種別を判断

- **Bash コマンド** → `{git_root}/.claude/allow_patterns.json` に追記
- **ツール名**（MCP ツール・ビルトインツール）→ `{git_root}/.claude/readonly_tools.json` に追記
  - `NEVER_READONLY`（Bash / Edit / Write / NotebookEdit / Agent / Skill / Monitor）は登録不可

### Step 4: 既存ファイルを確認して追記

**allow_patterns.json（Bash 用）:**

```json
{
  "bash": ["clasp push", "clasp deploy"]
}
```

- コマンド文字列への部分一致で allow
- `"clasp push"` は `clasp push --force` にもマッチする

**readonly_tools.json（ツール用）:**

```json
{
  "tools": ["mcp__kot__get_current_overtime", "WebSearch"]
}
```

ファイルが存在しなければ新規作成する。

### Step 5: 変更内容の確認

追記した内容を表示し、
「次回から該当操作は gatekeeper 静的チェックで即 allow されます」と伝える。

---

## 注意事項

- Bash パターンは部分一致のため、範囲を広く取りすぎないよう注意する
- `--force` 系・不可逆な削除は許可範囲を慎重に定義する
- 認証情報を読み取って外部送信するコマンドは一括許可を避ける
- ルールを削除・絞り込みたい場合は直接 JSON ファイルを編集する
