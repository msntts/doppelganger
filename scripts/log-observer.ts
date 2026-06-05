#!/usr/bin/env tsx
// CLI script called by skills (not a hook). Usage: tsx ~/.claude/scripts/log-observer.ts <event_type> <verdict>
import { appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const [, , event_type, verdict] = process.argv;
if (!event_type || !verdict) process.exit(0);

try {
  appendFileSync(
    join(homedir(), ".claude", "observer-log.jsonl"),
    JSON.stringify({
      timestamp: new Date().toISOString().slice(0, 19),
      event_type,
      verdict,
    }) + "\n",
    "utf-8",
  );
} catch {
  // fail-open
}
