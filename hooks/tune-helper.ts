#!/usr/bin/env tsx
/**
 * tune-helper.ts — observer/gatekeeper ログから allow/deny パターン候補を抽出する
 *
 * 使用方法: tsx hooks/tune-helper.ts [--project <path>]
 * 出力: JSON to stdout
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const NEVER_AUTO_SUGGEST: readonly string[] = [
  "rm",
  "rmdir",
  "del",
  "Remove-Item",
  "curl",
  "wget",
  "chmod",
  "chown",
  "sudo",
  "su",
  "| sh",
  "| bash",
  "| pwsh",
  "| powershell",
  "DROP",
  "DELETE FROM",
  "TRUNCATE",
  "--force",
  "--hard",
  "-rf",
  "-fr",
  "mkfs",
  "format",
];

const META_COMMANDS: readonly string[] = [
  "pnpm",
  "npm",
  "yarn",
  "npx",
  "uv",
  "python",
  "python3",
  "node",
  "tsx",
  "ts-node",
  "gh",
  "git",
  "docker",
  "docker-compose",
  "kubectl",
  "terraform",
  "aws",
  "gcloud",
];

interface PatternCandidate {
  pattern: string;
  count: number;
  examples: string[];
}

interface TuneOutput {
  allow_candidates: PatternCandidate[];
  deny_candidates: PatternCandidate[];
  skipped_count: number;
}

function parseProjectDir(): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--project");
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1];
  }
  return process.cwd();
}

function readJsonlLines(filePath: string): Record<string, unknown>[] {
  if (!existsSync(filePath)) return [];
  try {
    return readFileSync(filePath, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function isWithinDays(timestamp: string, days: number): boolean {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(timestamp).getTime() >= cutoff;
}

function extractPatternFromCommand(cmd: string): string[] {
  const patterns: string[] = [];
  const parts = cmd.split(/&&|\|\||;|\n/);
  for (const part of parts) {
    const trimmed = part.replace(/^\s*\|?\s*/, "").trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    const first = tokens[0] ?? "";
    if (!first || /^\d/.test(first) || first.startsWith("#")) continue;
    let pattern: string;
    if (META_COMMANDS.includes(first) && tokens[1]) {
      pattern = `${first} ${tokens[1]}`;
    } else {
      pattern = first;
    }
    patterns.push(pattern);
  }
  return patterns;
}

function isNeverSuggest(pattern: string): boolean {
  const lower = pattern.toLowerCase();
  return NEVER_AUTO_SUGGEST.some((n) => lower.includes(n.toLowerCase()));
}

function extractAllowCandidates(_projectDir: string): PatternCandidate[] {
  const logPath = join(homedir(), ".claude", "gatekeeper-log.jsonl");
  const entries = readJsonlLines(logPath);

  const counts = new Map<string, { count: number; examples: string[] }>();

  for (const entry of entries) {
    if (entry["tool"] !== "Bash") continue;
    if (entry["decision"] !== "allow") continue;
    if (
      typeof entry["reason"] !== "string" ||
      !entry["reason"].includes("静的ルール対象外")
    )
      continue;
    if (
      typeof entry["timestamp"] !== "string" ||
      !isWithinDays(entry["timestamp"], 30)
    )
      continue;

    const cmd =
      typeof entry["input_summary"] === "string" ? entry["input_summary"] : "";
    if (!cmd) continue;

    for (const pattern of extractPatternFromCommand(cmd)) {
      if (pattern.length < 2) continue;
      if (isNeverSuggest(pattern)) continue;

      const existing = counts.get(pattern) ?? { count: 0, examples: [] };
      existing.count++;
      if (existing.examples.length < 3) {
        existing.examples.push(cmd.slice(0, 80));
      }
      counts.set(pattern, existing);
    }
  }

  return Array.from(counts.entries())
    .map(([pattern, data]) => ({ pattern, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function extractDenyCandidates(_projectDir: string): PatternCandidate[] {
  return [];
}

function loadSkipList(): Set<string> {
  const path = join(homedir(), ".claude", "tune-skip.json");
  if (!existsSync(path)) return new Set();
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as {
      patterns?: unknown;
    };
    if (!Array.isArray(data.patterns)) return new Set();
    return new Set(data.patterns.filter((p): p is string => typeof p === "string"));
  } catch {
    return new Set();
  }
}

function loadExistingAllowPatterns(projectDir: string): Set<string> {
  const path = join(projectDir, ".claude", "allow_patterns.json");
  if (!existsSync(path)) return new Set();
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as { bash?: unknown };
    if (!Array.isArray(data.bash)) return new Set();
    return new Set(data.bash.filter((p): p is string => typeof p === "string"));
  } catch {
    return new Set();
  }
}

function loadExistingDenyPatterns(projectDir: string): Set<string> {
  const path = join(projectDir, ".claude", "denied_patterns.json");
  if (!existsSync(path)) return new Set();
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as {
      bash_patterns?: unknown;
    };
    if (!Array.isArray(data.bash_patterns)) return new Set();
    return new Set(
      data.bash_patterns.filter((p): p is string => typeof p === "string"),
    );
  } catch {
    return new Set();
  }
}

function dedup(
  candidates: PatternCandidate[],
  skipSets: Set<string>[],
): { filtered: PatternCandidate[]; removedCount: number } {
  let removedCount = 0;
  const filtered = candidates.filter((c) => {
    if (skipSets.some((s) => s.has(c.pattern))) {
      removedCount++;
      return false;
    }
    return true;
  });
  return { filtered, removedCount };
}

async function main(): Promise<void> {
  const projectDir = parseProjectDir();

  const rawAllow = extractAllowCandidates(projectDir);
  const rawDeny = extractDenyCandidates(projectDir);

  const skipList = loadSkipList();
  const existingAllow = loadExistingAllowPatterns(projectDir);
  const existingDeny = loadExistingDenyPatterns(projectDir);

  const { filtered: allowFiltered, removedCount: allowRemoved } = dedup(
    rawAllow,
    [skipList, existingAllow],
  );
  const { filtered: denyFiltered, removedCount: denyRemoved } = dedup(
    rawDeny,
    [skipList, existingDeny, existingAllow],
  );

  const output: TuneOutput = {
    allow_candidates: allowFiltered,
    deny_candidates: denyFiltered,
    skipped_count: allowRemoved + denyRemoved,
  };

  process.stdout.write(JSON.stringify(output) + "\n");
}

// expose for use in other functions (to avoid TS unused var warnings)
export { extractPatternFromCommand, isNeverSuggest, isWithinDays, readJsonlLines };

main().catch((err: Error) => {
  process.stderr.write(`[tune-helper] error: ${err.message}\n`);
  process.exit(1);
});
