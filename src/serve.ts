/**
 * Serve loop logic - extracted for testability.
 *
 * This module contains the core logic for processing email replies:
 * - Lock file management to prevent concurrent Claude spawns
 * - Reply recording and thread.md updates
 * - Claude spawning via tmux
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import { getProjectRoot, getReportsDir } from "./config.ts";
import {
  nextReplyNumber,
  writeReplyFile,
  replyFilePaths,
  hasUnprocessedReplies,
  appendToThread,
  buildReplyPrompt,
} from "./reply.ts";

export interface SpawnFn {
  (date: string, promptFile: string): void;
}

// Default spawn function uses Bun.spawn with tmux
let spawnFn: SpawnFn = (date: string, promptFile: string) => {
  const projectRoot = getProjectRoot();
  const windowName = `reply-${date}`;
  const claudeCmd = `claude --model sonnet -p < "${promptFile}"`;
  console.log(`🤖 Spawning Claude in tmux window '${windowName}'`);
  Bun.spawn(
    ["tmux", "new-window", "-d", "-n", windowName, "-c", projectRoot, claudeCmd],
    { stdio: ["ignore", "ignore", "ignore"] }
  );
};

// Track spawn count for testing
let spawnCount = 0;

/**
 * Set a custom spawn function (for testing).
 */
export function setSpawnFn(fn: SpawnFn) {
  spawnFn = fn;
}

/**
 * Reset spawn function to default.
 */
export function resetSpawnFn() {
  spawnFn = (date: string, promptFile: string) => {
    const projectRoot = getProjectRoot();
    const windowName = `reply-${date}`;
    const claudeCmd = `claude --model sonnet -p < "${promptFile}"`;
    console.log(`🤖 Spawning Claude in tmux window '${windowName}'`);
    Bun.spawn(
      ["tmux", "new-window", "-d", "-n", windowName, "-c", projectRoot, claudeCmd],
      { stdio: ["ignore", "ignore", "ignore"] }
    );
  };
}

/**
 * Get spawn count (for testing).
 */
export function getSpawnCount(): number {
  return spawnCount;
}

/**
 * Reset spawn count (for testing).
 */
export function resetSpawnCount() {
  spawnCount = 0;
}

/**
 * Check if lock file is stale (older than specified minutes).
 */
export function isLockStale(lockFile: string, staleMinutes: number = 10): boolean {
  if (!existsSync(lockFile)) return false;
  const stats = statSync(lockFile);
  const ageMs = Date.now() - stats.mtimeMs;
  return ageMs > staleMinutes * 60 * 1000;
}

/**
 * Clean stale lock files for all dates with unprocessed replies.
 */
export function cleanStaleLocks(staleMinutes: number = 10) {
  const reportsDir = getReportsDir();
  if (!existsSync(reportsDir)) return;

  const dates = readdirSync(reportsDir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  for (const date of dates) {
    const lockFile = join(reportsDir, date, "responses", ".processing");
    if (isLockStale(lockFile, staleMinutes)) {
      console.log(`  Cleaning stale lock for ${date}`);
      unlinkSync(lockFile);
    }
  }
}

/**
 * Spawn Claude in tmux to process replies for a date.
 * Returns true if spawned, false if skipped.
 */
export function spawnClaudeInTmux(date: string): boolean {
  const prompt = buildReplyPrompt(date);
  const promptFile = join(getReportsDir(), date, "responses", ".reply-prompt.md");
  writeFileSync(promptFile, prompt, "utf8");

  spawnFn(date, promptFile);
  spawnCount++;
  return true;
}

export interface TriggerResult {
  triggered: boolean;
  reason: "lock_exists" | "no_unprocessed" | "spawned" | "stale_cleaned_and_spawned";
}

/**
 * Trigger processing for a date if there are unprocessed replies and no lock.
 * Fire and forget — next poll cycle handles the rest.
 *
 * Returns result indicating what happened.
 */
export function triggerProcessing(date: string, staleMinutes: number = 10): TriggerResult {
  const responsesDir = join(getReportsDir(), date, "responses");
  const lockFile = join(responsesDir, ".processing");

  // Clean stale lock if needed
  let staleCleaned = false;
  if (isLockStale(lockFile, staleMinutes)) {
    console.log(`  Cleaning stale lock for ${date}`);
    unlinkSync(lockFile);
    staleCleaned = true;
  }

  // If lock exists, Claude is already running
  if (existsSync(lockFile)) {
    return { triggered: false, reason: "lock_exists" };
  }

  // If no unprocessed replies, nothing to do
  if (!hasUnprocessedReplies(responsesDir)) {
    return { triggered: false, reason: "no_unprocessed" };
  }

  // Write lock and spawn Claude
  writeFileSync(lockFile, new Date().toISOString(), "utf8");
  try {
    spawnClaudeInTmux(date);
  } catch (err) {
    unlinkSync(lockFile);
    throw err;
  }

  return {
    triggered: true,
    reason: staleCleaned ? "stale_cleaned_and_spawned" : "spawned"
  };
}

/**
 * Record a reply without Gmail fetch (for testing or when body is already known).
 * Returns the date extracted from subject.
 *
 * @param replyMessageId - Gmail Message-ID of the reply, used for threading responses
 */
export function recordReplyDirect(
  from: string,
  subject: string,
  msgDate: string,
  body: string,
  replyMessageId?: string
): string {
  const match = subject.match(/(\d{4}-\d{2}-\d{2})/);
  const date = match ? match[1] : new Date().toISOString().split("T")[0];

  const responsesDir = join(getReportsDir(), date, "responses");
  const threadFile = join(getReportsDir(), date, "thread.md");
  mkdirSync(responsesDir, { recursive: true });

  const num = nextReplyNumber(responsesDir);
  const paths = replyFilePaths(responsesDir, num);

  // Write the reply file
  writeReplyFile(paths.replyFile, num, from, msgDate, subject, body);

  // Save reply's Message-ID for threading responses
  if (replyMessageId) {
    writeFileSync(join(responsesDir, ".last-reply-id"), replyMessageId, "utf8");
  }

  // Append to thread.md with NEW marker
  appendToThread(threadFile, `NEW Reply #${num} (${msgDate} from ${from})`, body);

  return date;
}

/**
 * Get lock file path for a date.
 */
export function getLockFile(date: string): string {
  return join(getReportsDir(), date, "responses", ".processing");
}

/**
 * Remove lock file for a date.
 */
export function removeLock(date: string): boolean {
  const lockFile = getLockFile(date);
  if (existsSync(lockFile)) {
    unlinkSync(lockFile);
    return true;
  }
  return false;
}
