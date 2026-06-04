#!/usr/bin/env tsx
/**
 * UserPromptSubmit hook — ユーザーターンの判断帰属を判定して observer-log.jsonl に記録する
 *
 * ログローテーション: 500KB 超で .jsonl.1 → .jsonl.2 にシフト（2世代保持）
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";

const LOG_PATH = join(homedir(), ".claude", "observer-log.jsonl");
const LOG_MAX_BYTES = 500 * 1024;
const LOG_BACKUPS = 2;
const TTL_MS = 60 * 60 * 1000; // 60分

const REJECTION_RE = /却下|やり直し|やりなおし|なおして|直して|違う|だめ|NG|使えない|別の/i;
const MODIFICATION_RE = /でも|ただし|修正|変えて|追加して|ただ(?!し)|一方で/;
const APPROVAL_RE = /OK|ok|了解|承認|進めて?|進め|すすめ|続けて?|続け|問題ない|大丈夫|いいです|そうです|はい|お願いします?|おねがい|コミットして|pushして|push して/;

type ResponseType = "approval" | "modification" | "rejection" | "unclear";

// observer-stop-prompt.ts が表示する選択肢メニューへの直接入力
const SELECTION_MAP: Record<string, ResponseType> = {
  "1": "approval",
  "2": "modification",
  "3": "rejection",
  "4": "unclear",
};

function classifyResponse(text: string): ResponseType {
  const trimmed = text.trim();
  if (SELECTION_MAP[trimmed]) return SELECTION_MAP[trimmed];
  if (REJECTION_RE.test(text)) return "rejection";
  if (MODIFICATION_RE.test(text)) return "modification";
  // 承認語を含み短いメッセージ（30文字以内）を承認とみなす
  if (text.length <= 30 && APPROVAL_RE.test(text)) return "approval";
  return "unclear";
}

interface ObserverState {
  session_id: string;
  pending_skill: string | null;
  pending_skill_ts: string | null;
  pending_skill_args: string | null;
}

interface ObserverEntry {
  timestamp: string;
  session_id: string;
  event_type: "user_turn";
  prompt_preview: string;
  prompt_len: number;
  human_attribution: "autonomous" | "post_ai";
  response_type?: ResponseType;
  preceding_skill?: string;
  preceding_skill_ts?: string;
  ai_elapsed_sec?: number;
  cwd: string;
}

function rotateLog(): void {
  if (!existsSync(LOG_PATH) || statSync(LOG_PATH).size < LOG_MAX_BYTES) return;
  for (let i = LOG_BACKUPS; i >= 1; i--) {
    const src = i === 1 ? LOG_PATH : `${LOG_PATH}.${i - 1}`;
    const dst = `${LOG_PATH}.${i}`;
    if (existsSync(src)) renameSync(src, dst);
  }
}

function readState(sessionId: string): ObserverState | null {
  const stateFile = join(tmpdir(), `claude_observer_${sessionId}.json`);
  if (!existsSync(stateFile)) return null;
  try {
    return JSON.parse(readFileSync(stateFile, "utf-8")) as ObserverState;
  } catch {
    return null;
  }
}

function resetState(sessionId: string, state: ObserverState): void {
  const stateFile = join(tmpdir(), `claude_observer_${sessionId}.json`);
  try {
    writeFileSync(
      stateFile,
      JSON.stringify({ ...state, pending_skill: null, pending_skill_ts: null, pending_skill_args: null }),
      "utf-8",
    );
  } catch {
    // fail-open
  }
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

    const sessionId: string = data.session_id ?? "";
    const prompt: string = data.prompt ?? "";
    const now = new Date();

    const state = readState(sessionId);

    let humanAttribution: "autonomous" | "post_ai" = "autonomous";
    let precedingSkill: string | undefined;
    let precedingSkillTs: string | undefined;
    let aiElapsedSec: number | undefined;

    if (state?.pending_skill && state.pending_skill_ts) {
      const skillTs = new Date(state.pending_skill_ts);
      const elapsed = now.getTime() - skillTs.getTime();

      if (elapsed <= TTL_MS) {
        humanAttribution = "post_ai";
        precedingSkill = state.pending_skill;
        precedingSkillTs = state.pending_skill_ts;
        aiElapsedSec = Math.round(elapsed / 1000);
      }
    }

    const entry: ObserverEntry = {
      timestamp: now.toISOString().slice(0, 19),
      session_id: sessionId,
      event_type: "user_turn",
      prompt_preview: prompt.slice(0, 200),
      prompt_len: prompt.length,
      human_attribution: humanAttribution,
      cwd: process.cwd(),
    };

    if (humanAttribution === "post_ai") {
      entry.response_type = classifyResponse(prompt);
      entry.preceding_skill = precedingSkill;
      entry.preceding_skill_ts = precedingSkillTs;
      entry.ai_elapsed_sec = aiElapsedSec;
    }

    rotateLog();
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", "utf-8");

    // ユーザーがスラッシュコマンドを打った場合、次のターンのために pending_skill をセット
    // （/review → Claude がスキル実行 → ユーザーが応答 → post_ai になるべき）
    const slashMatch = prompt.match(/^\/([a-zA-Z][\w-]*)(?:\s|$)/);
    if (slashMatch) {
      const nextState: ObserverState = {
        session_id: sessionId,
        pending_skill: slashMatch[1],
        pending_skill_ts: now.toISOString(),
        pending_skill_args: null,
      };
      const stateFile = join(tmpdir(), `claude_observer_${sessionId}.json`);
      writeFileSync(stateFile, JSON.stringify(nextState), "utf-8");
    } else if (state) {
      resetState(sessionId, state);
    }
  } catch {
    // fail-open
  }

  process.exit(0);
}

main();
