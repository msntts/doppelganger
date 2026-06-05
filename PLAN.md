# doppelganger リファクタリング計画

## 目的

hooks/ の重複コードを共有モジュールに括り出し、保守性を高める。
挙動変更なし・機能追加なし。リファクタのみ。

## 環境

- Windows 11 / TypeScript, tsx
- hooks/ は `~/.claude/hooks/` にシンボリックリンクされ、**毎ツール呼び出し時にライブ実行**される

## 基本方針

- **1 タスク = 1 コミット**（`/execute` 規約）
- **挙動完全維持**を各タスクの受け入れ条件に明記する
- 各タスク後に hook 単位の stdin 検証を実施する（tsconfig 無し・tsx は型チェック不要なため）
- 検証方法: 代表的な hook-input JSON を stdin で流し、変更前と出力/exit が一致することを確認

## 重複の実測値

| 重複パターン | 件数 | 対象ファイル |
|---|---|---|
| stdin 読み取り + JSON.parse | 9 | 全 hook |
| rotateLog (500KB/2-gen) | 3 | observer-prompt, observer-agent, work-logger |
| JSONL archive append | 2 | observer-prompt, observer-agent |
| ISO タイムスタンプ手書き | 8回 | gatekeeper (writeLog 呼び出しごと) |

⚠️ gatekeeper の rotateLog は **10MB/1-gen** で方式が異なる。他の 3 本と統一しない。

## Hotfix（最優先）

<!-- 緊急対応はここに積む -->

---

## タスク一覧

### [x] Task 1: package-lock.json 削除

**背景**: pnpm が正（commit `54431fa` で統一済み）なのに `package-lock.json` が残存。
**変更**: `package-lock.json` を削除する。
**受け入れ条件**: `pnpm install` が正常に動作し、hook が tsx で実行できること。
**検証**: `tsx hooks/event-log.ts` がエラーなく import できること。

---

### [x] Task 2: gatekeeper.ts — ISO タイムスタンプを writeLog に閉じ込める

**背景**: `new Date().toISOString().slice(0, 19)` を `writeLog` 呼び出しごとに 8 回手で渡している。
**変更**: `writeLog` 内で `timestamp` を自動生成し、呼び出し側から引数を削除する。
**受け入れ条件**: gatekeeper の判定結果（allow/block）とログ出力が変更前と完全一致。
**検証**: allow ケース・block ケースの JSON を stdin で流して出力を比較。

---

### [x] Task 3: hooks/hook-io.ts 抽出 — stdin 読み取りの共通化

**背景**: 以下の 9 hook に同一ボイラープレートが存在する。

```typescript
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) { chunks.push(chunk as Buffer); }
const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
```

**変更**: `hooks/hook-io.ts` を新規作成し `readHookInput<T>()` を export する。
observer-prompt / observer-agent / observer-skill / observer-stop-prompt / observer-cleanup /
work-logger / caffeinate / check-rm-safety の 8 hook に適用する。
**gatekeeper.ts は Task 6 で別途適用**（最重要ファイルなので分離）。
**受け入れ条件**: 各 hook の stdin/stdout/exit が変更前と完全一致。

---

### [ ] Task 4: hooks/archive-log.ts 抽出 — rotateLog + appendArchive の共通化

**背景**: observer-prompt・observer-agent・work-logger に `rotateLog(500KB/2-gen)` の完全同一コピーが 3 つ。
observer-prompt と observer-agent では homedir JSONL への append も重複。

**変更**: `hooks/archive-log.ts` を新規作成し以下を export する。
- `rotateLog(path: string, maxBytes?: number, backups?: number): void`  
  — デフォルト値で 500KB/2-gen を保持する（gatekeeper の 10MB/1-gen は触らない）
- `appendArchive(entry: Record<string, unknown>): void`  
  — LOG_PATH への rotate + appendFileSync をまとめる

**受け入れ条件**: observer-prompt・observer-agent・work-logger のログ出力・ローテーション動作が変更前と完全一致。
gatekeeper の `rotateLog` は変更しない。

---

### [ ] Task 5: observer-prompt / observer-agent / work-logger を archive-log.ts に移行

Task 4 の archive-log.ts を使って 3 hook から重複コードを除去する。
**受け入れ条件**: 各 hook の stdout/exit が変更前と完全一致。ログローテーションの閾値・世代数が変わらない。

---

### [ ] Task 6: gatekeeper.ts を hook-io.ts に移行（最後・最慎重）

**背景**: gatekeeper は直近で何度も変更されており、最重要ファイル。
**変更**: Task 3 で作成した `readHookInput<T>()` を gatekeeper に適用する。
**受け入れ条件**:
- allow / block それぞれのシナリオで出力・exit が変更前と完全一致
- PermissionRequest と PreToolUse の両イベントで動作確認する
- `NEVER_READONLY` セットの中身は変更しない

---

### [ ] Task 7: docs/briefs アーカイブ整理（任意）

`docs/briefs/step-1-*` は `/tune` 実装時のブリーフで現状は陳腐化している。
削除 or `docs/archive/` への移動を検討する。**ユーザー確認後に実施**。

---

## 検証用サンプル入力

```json
// PreToolUse (Bash) — allow ケース
{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"},"session_id":"test123","cwd":"/tmp"}

// PreToolUse (Write) — block ケース（gatekeeper 未評価）
{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/x.txt"},"session_id":"test_no_flag","cwd":"/tmp"}

// UserPromptSubmit — observer-prompt
{"session_id":"test123","prompt":"了解"}

// PostToolUse — work-logger
{"tool_name":"Bash","tool_input":{"command":"ls"},"session_id":"test123"}
```

---

## メモ・決定事項

- 新規モジュールの置き場: `hooks/hook-io.ts`・`hooks/archive-log.ts`（既存の `event-log.ts` と同列）
- hooks/ は `~/.claude/hooks/` へのシンボリックリンク実体なので相対 import は実証済み
- `pnpm-workspace.yaml` (`allowBuilds: esbuild: true`) は esbuild の build 設定なので保持する
- task 実行は `/execute` で進める

## 完了済みフェーズ

<!-- Phase {N}: {フェーズ名} `{開始ハッシュ}..{終了ハッシュ}` -->
