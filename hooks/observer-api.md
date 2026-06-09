# Observer イベントログ API

フックやスキルがセッション内の文脈を共有するための IPC バス。
ファイルストレージではなく **OS メッセージング** として扱う（`tmpdir()` に置き、セッション終了後は OS が回収）。

## ファイル

```
{tmpdir()}/claude_events_{session_id}.jsonl   — セッションスコープ、100件ローリング
~/.claude/observer-log.jsonl                  — 長期アーカイブ（分析用、書式変更不可）
```

## API（`event-log.ts`）

```typescript
import { appendEvent, readEvents, eventLogPath, trimLog } from "./event-log.ts";

appendEvent(sessionId, event); // イベントを追記（trim はベストエフォート）
readEvents(sessionId); // 末尾 100 件を返す（ファイルがなければ []）
eventLogPath(sessionId); // ファイルパスを返す
trimLog(path); // 100 件超を切り詰める
```

## イベントスキーマ

| kind            | 主なフィールド                                          | 書くフック                             |
| --------------- | ------------------------------------------------------- | -------------------------------------- |
| `skill_start`   | `skill`, `args`, `source: "user_cmd"\|"claude_tool"`    | observer-skill.ts / observer-prompt.ts |
| `agent_invoked` | `description`, `cwd`                                    | observer-agent.ts                      |
| `user_response` | `human_attribution`, `response_type`, `preceding_skill` | observer-prompt.ts                     |

## 新しいフック・スキルを書くとき

- **読みたい場合** → `readEvents(sessionId)` で末尾から走査する
- **書きたい場合** → `appendEvent(sessionId, { kind: "...", session_id, ...fields })` を呼ぶ
- `ts` フィールドは `appendEvent` が自動付与するので渡さない
- 新しい `kind` を追加する場合は `event-log.ts` の型定義に追記する
- セッション状態ファイル（旧 `claude_observer_*.json`）は廃止済み。使わない
