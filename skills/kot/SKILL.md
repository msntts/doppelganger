---
name: kot
description: KING OF TIME（勤怠管理）の残業時間・勤怠状況取得。「今月の残業時間」「先月の残業」「年度の残業」「勤怠承認状況」「タイムカード」「KOT」等で使う。`mcp__kot__*` ツールへルーティングし、Bash や WebFetch で時間を再計算しない。
user-invocable: true
---

# /kot

KING OF TIME 関連のクエリは必ず `mcp__kot__*` ツールを使う。
Bash・WebFetch・スクレイピングで時間を再計算しないこと（公式 MCP の値が信頼ソース）。

## ツール対応表

| 要求 | ツール |
|------|--------|
| 今月の残業時間（current 月） | `mcp__kot__get_current_overtime` |
| 先月以前の月次残業 | `mcp__kot__get_monthly_overtime` |
| 年度通算（fiscal）の残業 | `mcp__kot__get_fiscal_overtime` |
| 月次承認状況 | `mcp__kot__get_monthly_approval_status` |

## 利用不可のとき

`mcp__kot__*` ツールが見えない場合は kot MCP サーバーが未登録の状態。
ユーザーに「`../rpa/` プロジェクト配下から実行してください」と案内する（kot MCP は rpa の `.mcp.json` に登録）。
