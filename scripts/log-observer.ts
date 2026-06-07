#!/usr/bin/env tsx
// CLI script called by skills (not a hook). Usage: tsx ~/.claude/scripts/log-observer.ts <event_type> <verdict>
import { appendArchive } from "../hooks/archive-log.ts";

const [, , event_type, verdict] = process.argv;
if (!event_type || !verdict) process.exit(0);

try {
  appendArchive({
    timestamp: new Date().toISOString().slice(0, 19),
    event_type,
    verdict,
  });
} catch {
  // fail-open
}
