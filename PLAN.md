# observer 層実装 — 判断帰属トラッキング

## プロジェクト概要
doppelganger フックに observer 層を追加し、「人間の自発的判断」vs「AI提案を承認した判断」を区別して記録する。

## 環境
- macOS / TypeScript (tsx)
- Claude Code hooks (UserPromptSubmit / PreToolUse / PostToolUse / Stop)

## 受け入れ条件
- 各フックに stdin テストデータを流し込み、`~/.claude/observer-log.jsonl` に期待するエントリが記録されること
- 実際のセッションで review スキルを呼んだ後の次ユーザーターンが `post_ai` に分類されること

## 完了条件
- `npx tsx hooks/observer-skill.ts` / `observer-prompt.ts` でコンパイルエラーなし
- Phase 1 受け入れ条件の 4 テストがすべてパス

---

## 🔥 Hotfix（最優先）

<!-- 動作確認中の不具合・緊急対応はここに積む。未完了がある限り最優先で対応する -->

---

## Phase 1: 最小実装（二値分類: post_ai / autonomous）

- [ ] 1-1. `hooks/observer-skill.ts` 新規作成
- [ ] 1-2. `hooks/observer-prompt.ts` 新規作成
- [ ] 1-3. `settings.json` にフック登録（observer-prompt / observer-skill）

## Phase 2: Agent 検出

- [ ] 2-1. `hooks/observer-agent.ts` 新規作成
- [ ] 2-2. `settings.json` に PostToolUse Agent matcher を追加

## Phase 3: シグナル強度分類（テキスト解析）

- [ ] 3-1. `observer-prompt.ts` に `response_type` フィールドを追加

## Phase 4: Stop フックによるクリーンアップ

- [ ] 4-1. `hooks/observer-cleanup.ts` 新規作成
- [ ] 4-2. `settings.json` に Stop フックを追加

---

## メモ・決定事項

### 解決する問題

Claude Code の insights レポートはセッション JSONL の「ユーザーターン」をすべて「人間の発言」として帰属する。しかし実際には review/advisor スキルの出力を人間が中継している場合があり、ログ上は同じ形をしている。

「人間が自発的に判断したこと」と「AIが提案して人間が承認したこと」を区別できないと、真の判断基準モデルを学習できない。

### 計測したいシグナル（優先順位順）

1. **エージェント提案を人間が否定・修正した** — 価値観が最も純粋に出る
2. **エージェント介在なしに人間が自発的に述べた制約・仮説・修正** — 判断基準のコア
3. **エージェント提案を人間がそのまま承認した** — 弱いシグナル（ノイズ多め）

### クロスターン状態管理

フック間で状態を共有する手段はファイルのみ（環境変数はプロセスをまたいで共有不可）。セッション単位の一時ファイルを使う。

```
/tmp/claude_observer_{session_id}.json
```

```typescript
interface ObserverState {
  session_id: string;
  pending_skill: string | null;      // 直前に呼ばれたスキル名
  pending_skill_ts: string | null;   // ISO タイムスタンプ
  pending_skill_args: string | null; // args 先頭100文字
}
```

**TTL**: `pending_skill_ts` から60分以上経過していれば `null` 扱い（陳腐化防止）。

### 処理フロー

```
[Skill ツール呼び出し]
  PreToolUse (observer-skill.ts, matcher: Skill)
    → /tmp/claude_observer_{session_id}.json に pending_skill を書く

[人間がメッセージを送る]
  UserPromptSubmit (observer-prompt.ts)
    → /tmp/claude_observer_{session_id}.json を読む
    → pending_skill が存在: human_attribution = "post_ai"
    → pending_skill が null:  human_attribution = "autonomous"
    → observer-log.jsonl に記録
    → pending_skill をリセット

[Claude のターン終了]
  Stop (observer-cleanup.ts) ← Phase 4
    → tmpファイル削除
```

### 出力ログスキーマ: `~/.claude/observer-log.jsonl`

```typescript
interface ObserverEntry {
  timestamp: string;           // ISO 秒精度
  session_id: string;
  event_type: "user_turn" | "skill_invoked" | "agent_invoked";

  // user_turn フィールド
  prompt_preview?: string;     // 先頭200文字
  prompt_len?: number;
  human_attribution: "autonomous" | "post_ai" | "unknown";

  // post_ai のとき追加
  preceding_skill?: string;
  preceding_skill_ts?: string;
  ai_elapsed_sec?: number;

  // skill_invoked フィールド
  skill_name?: string;
  skill_args?: string;         // 先頭100文字

  // agent_invoked フィールド
  agent_description?: string;  // 先頭100文字

  // 共通
  cwd?: string;
}
```

### フック追加後の全体構成

```
UserPromptSubmit → caffeinate.ts
               → observer-prompt.ts   ← Phase 1

PreToolUse     → gatekeeper.ts
               → remind-toolsearch.ts (matcher: mcp__.*)
               → observer-skill.ts    ← Phase 1 (matcher: Skill)

PostToolUse    → work-logger.ts
               → observer-agent.ts    ← Phase 2 (matcher: Agent)

Stop           → caffeinate.ts
               → observer-cleanup.ts  ← Phase 4
```

### Phase 1 受け入れテスト

```bash
# 1. observer-skill.ts テスト
echo '{"hook_event_name":"PreToolUse","tool_name":"Skill","tool_input":{"skill":"review"},"session_id":"test-123"}' \
  | npx tsx hooks/observer-skill.ts
# → /tmp/claude_observer_test-123.json が作成され pending_skill="review" が入っていること

# 2. observer-prompt.ts テスト (post_ai パス)
echo '{"hook_event_name":"UserPromptSubmit","session_id":"test-123","prompt":"OK 進めて"}' \
  | npx tsx hooks/observer-prompt.ts
# → ~/.claude/observer-log.jsonl に human_attribution="post_ai", preceding_skill="review" のエントリが追記されること
# → /tmp/claude_observer_test-123.json の pending_skill が null になっていること

# 3. observer-prompt.ts テスト (autonomous パス)
echo '{"hook_event_name":"UserPromptSubmit","session_id":"new-456","prompt":"設計について制約を追加したい"}' \
  | npx tsx hooks/observer-prompt.ts
# → ~/.claude/observer-log.jsonl に human_attribution="autonomous" のエントリが追記されること

# 4. 実際のセッションで review スキルを呼んだ後の次のユーザーターンが post_ai に分類されること
```

### Phase 3 テキスト分類パターン

```typescript
const REJECTION_PATTERNS = [/却下|やり直し|違う|だめ|NG|使えない|別の/i];
const MODIFICATION_PATTERNS = [/でも|ただし|修正|変えて|直して|追加して|ただ(?!し)|一方で/];
const APPROVAL_PATTERNS = [/^(OK|ok|了解|承認|進めて|続けて|問題ない|大丈夫|いいです?|そうで?す|はい)[\s。！]?$/];
// response_type: "approval" | "modification" | "rejection" | "unclear"
```

### work-logger.ts を拡張せず独立フックにする理由

work-logger.ts は PostToolUse のみを扱い、UserPromptSubmit / PreToolUse をまたいだ状態管理は行っていない。observer 層は「複数フックにまたがるセッション状態」を管理する必要があり、アーキテクチャ的に別物。

### Phase 1 に LLM 分類を含めない理由

gatekeeper.ts の開発で得た教訓: LLM 分類は非決定的になりやすく、設計検証が難しい。Phase 1 は「スキルが呼ばれたか否か」という二値の事実だけを記録し、テキスト分類は実データが蓄積された Phase 3 以降で導入する。

---

## 完了済みフェーズ

<!-- Phase {N}: {フェーズ名} `{開始ハッシュ}..{終了ハッシュ}` -->
- Phase 0-5: claude-helm → doppelganger 統合 `d20eb86`
- gatekeeper カテゴリ分類アーキテクチャリファクタリング（全フェーズ完了）
