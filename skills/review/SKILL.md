---
name: review
description: コード変更を Security/DevOps の観点でレビューし統合判定を返す。「レビューして」「コミット前チェック」「push 前確認」「変更を見て」「これコミットして大丈夫か」等で使う。CLAUDE.md ルールにより毎コミット直前（security）・push 前（devops）に自動起動する。
user-invocable: true
allowed-tools:
  - Bash
  - Agent
---

# /review

git の差分をレビューする。引数で実行モードを指定する。

引数: `$ARGUMENTS`（`security` / `devops` / 省略時は両方）

---

## モード

| 引数 | 実行内容 | 自動起動タイミング |
|---|---|---|
| `security` | Security エージェントのみ | コミット前（毎回） |
| `devops` | DevOps エージェント（型判定あり） | push 前 |
| 省略 / その他 | Security + DevOps 両方 | 手動 |

---

## 実行フロー

### 1. 差分の収集

```bash
git diff HEAD
```

差分が空の場合は `git diff HEAD~1 HEAD` を使う。それも空なら「レビュー対象の変更がありません」と伝えて終了する。

---

### 2. モード判定とエージェント起動

**`security` モード（コミット前）**

Security エージェントのみ起動する。

**`devops` モード（push 前）**

差分に含まれるファイルパスを確認し、以下のルールで DevOps エージェントを起動するか判定する：

- 変更ファイルがすべて `*.md` / `*.txt` / `docs/**` に該当 → DevOps スキップ。「ドキュメントのみの変更のため DevOps レビューをスキップしました」と伝えて終了。
- 上記以外のファイルが1つでも含まれる → DevOps エージェントを起動する。

**省略モード**

Security + DevOps 両方を並列起動する。

---

### 3. エージェント起動

**Security モード**: `security-reviewer` サブエージェントに手順1の差分を渡して起動する。

**DevOps モード**: `devops-reviewer` サブエージェントに手順1の差分を渡して起動する。

各エージェントのシステムプロンプトは `~/.claude/agents/` で管理されている。

---

### 4. 統合と報告

実行したエージェントの結果を以下のフォーマットで報告する：

```
## /review 結果

### Security
{Security エージェントの出力 / スキップした場合は省略}

### DevOps
{DevOps エージェントの出力 / スキップした場合は「（ドキュメントのみのためスキップ）」}

---
### 判定
🔴 要修正   — high severity の問題あり。修正してからコミット・push してください。
🟡 要確認   — medium / low の指摘あり。内容を確認してから進めてください。
🟢 問題なし  — 実行した観点で問題は検出されませんでした。
```

---

### 5. 判定ログの記録（必須 — ステップ6より前に必ず実行すること）

判定に応じて以下のいずれか一つを実行する：

**🟢 問題なし:**
```bash
tsx ~/.claude/scripts/log-observer.ts review_verdict 問題なし
```

**🟡 要確認:**
```bash
tsx ~/.claude/scripts/log-observer.ts review_verdict 要確認
```

**🔴 要修正:**
```bash
tsx ~/.claude/scripts/log-observer.ts review_verdict 要修正
```

---

### 6. 判定後の自律継続

- **🟢 問題なし**: 報告直後にそのまま元の処理（コミットまたは push）を実行する。
- **🟡 要確認**: 指摘内容を報告し、進めるかどうかをユーザーに確認してから止まる。
- **🔴 要修正**: 指摘内容を報告して処理を中断する。修正後に再度 `/review` を呼び出す。
