import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, utimesSync, statSync } from "fs";
import { join } from "path";
import {
  triggerProcessing,
  cleanStaleLocks,
  recordReplyDirect,
  isLockStale,
  getLockFile,
  removeLock,
  setSpawnFn,
  resetSpawnFn,
  getSpawnCount,
  resetSpawnCount,
} from "../src/serve.ts";
import { hasUnprocessedReplies } from "../src/reply.ts";
import { getReportsDir } from "../src/config.ts";

const TEST_DATE = "2098-12-31";

function getTestDir() {
  return join(getReportsDir(), TEST_DATE);
}

function getResponsesDir() {
  return join(getTestDir(), "responses");
}

beforeEach(() => {
  // Create test directory structure
  mkdirSync(getResponsesDir(), { recursive: true });

  // Create a minimal thread.md so buildReplyPrompt doesn't throw
  const threadFile = join(getTestDir(), "thread.md");
  writeFileSync(threadFile, `# Carlton Thread — ${TEST_DATE}\n\n## Briefing\n\nTest briefing.\n\n---\n`);

  // Reset spawn tracking
  resetSpawnCount();

  // Use a mock spawn function that just tracks calls
  setSpawnFn((date: string, promptFile: string) => {
    // Mock: don't actually spawn anything
  });
});

afterEach(() => {
  // Clean up test data
  rmSync(getTestDir(), { recursive: true, force: true });
  resetSpawnFn();
  resetSpawnCount();
});

describe("triggerProcessing - basic behavior", () => {
  test("spawns when unprocessed replies exist and no lock", () => {
    writeFileSync(join(getResponsesDir(), "01-reply.md"), "test reply");

    const result = triggerProcessing(TEST_DATE);

    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("spawned");
    expect(getSpawnCount()).toBe(1);
    expect(existsSync(getLockFile(TEST_DATE))).toBe(true);
  });

  test("skips when lock exists", () => {
    writeFileSync(join(getResponsesDir(), "01-reply.md"), "test reply");
    writeFileSync(getLockFile(TEST_DATE), new Date().toISOString());

    const result = triggerProcessing(TEST_DATE);

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("lock_exists");
    expect(getSpawnCount()).toBe(0);
  });

  test("skips when no unprocessed replies", () => {
    // No reply files = nothing to process

    const result = triggerProcessing(TEST_DATE);

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("no_unprocessed");
    expect(getSpawnCount()).toBe(0);
  });

  test("skips when all replies have responses", () => {
    writeFileSync(join(getResponsesDir(), "01-reply.md"), "reply");
    writeFileSync(join(getResponsesDir(), "01-response.md"), "response");

    const result = triggerProcessing(TEST_DATE);

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("no_unprocessed");
    expect(getSpawnCount()).toBe(0);
  });
});

describe("triggerProcessing - stale lock handling", () => {
  test("cleans stale lock and spawns", () => {
    writeFileSync(join(getResponsesDir(), "01-reply.md"), "test reply");

    // Create a stale lock (use 0 minutes for immediate staleness in test)
    const lockFile = getLockFile(TEST_DATE);
    writeFileSync(lockFile, "stale");
    const oldTime = new Date(Date.now() - 15 * 60 * 1000);
    utimesSync(lockFile, oldTime, oldTime);

    // Use 1 minute threshold for the test
    const result = triggerProcessing(TEST_DATE, 1);

    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("stale_cleaned_and_spawned");
    expect(getSpawnCount()).toBe(1);
  });

  test("respects fresh lock", () => {
    writeFileSync(join(getResponsesDir(), "01-reply.md"), "test reply");

    // Create a fresh lock
    const lockFile = getLockFile(TEST_DATE);
    writeFileSync(lockFile, new Date().toISOString());

    const result = triggerProcessing(TEST_DATE);

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("lock_exists");
    expect(getSpawnCount()).toBe(0);
  });
});

describe("triggerProcessing - NO DOUBLE SPAWN (race condition prevention)", () => {
  test("rapid successive calls only spawn once", () => {
    writeFileSync(join(getResponsesDir(), "01-reply.md"), "test reply");

    // Call triggerProcessing multiple times rapidly
    const result1 = triggerProcessing(TEST_DATE);
    const result2 = triggerProcessing(TEST_DATE);
    const result3 = triggerProcessing(TEST_DATE);

    // First call should spawn
    expect(result1.triggered).toBe(true);
    expect(result1.reason).toBe("spawned");

    // Subsequent calls should be blocked by lock
    expect(result2.triggered).toBe(false);
    expect(result2.reason).toBe("lock_exists");
    expect(result3.triggered).toBe(false);
    expect(result3.reason).toBe("lock_exists");

    // Only ONE spawn total
    expect(getSpawnCount()).toBe(1);
  });

  test("multiple replies trigger only one spawn", () => {
    // Write 5 replies
    for (let i = 1; i <= 5; i++) {
      writeFileSync(join(getResponsesDir(), `0${i}-reply.md`), `reply ${i}`);
    }

    // Trigger processing multiple times (simulating multiple poll cycles)
    triggerProcessing(TEST_DATE);
    triggerProcessing(TEST_DATE);
    triggerProcessing(TEST_DATE);

    // Still only ONE spawn
    expect(getSpawnCount()).toBe(1);
  });

  test("second batch triggers after first completes", () => {
    // First batch: 2 replies
    writeFileSync(join(getResponsesDir(), "01-reply.md"), "reply 1");
    writeFileSync(join(getResponsesDir(), "02-reply.md"), "reply 2");

    const result1 = triggerProcessing(TEST_DATE);
    expect(result1.triggered).toBe(true);
    expect(getSpawnCount()).toBe(1);

    // Simulate Claude finishing: write response and remove lock
    writeFileSync(join(getResponsesDir(), "02-response.md"), "response to batch 1");
    removeLock(TEST_DATE);

    // No new replies yet - should not spawn
    const result2 = triggerProcessing(TEST_DATE);
    expect(result2.triggered).toBe(false);
    expect(result2.reason).toBe("no_unprocessed");
    expect(getSpawnCount()).toBe(1);

    // New reply arrives
    writeFileSync(join(getResponsesDir(), "03-reply.md"), "reply 3");

    // Now should spawn again
    const result3 = triggerProcessing(TEST_DATE);
    expect(result3.triggered).toBe(true);
    expect(result3.reason).toBe("spawned");
    expect(getSpawnCount()).toBe(2);
  });
});

describe("recordReplyDirect", () => {
  test("creates reply file and updates thread.md", () => {
    const date = recordReplyDirect(
      "user@test.com",
      `${TEST_DATE} Carlton Briefing Notes`,
      new Date().toISOString(),
      "What time is the meeting?"
    );

    expect(date).toBe(TEST_DATE);
    expect(existsSync(join(getResponsesDir(), "01-reply.md"))).toBe(true);

    const threadContent = readFileSync(join(getTestDir(), "thread.md"), "utf8");
    expect(threadContent).toContain("## NEW Reply #1");
    expect(threadContent).toContain("What time is the meeting?");
  });

  test("increments reply number correctly", () => {
    recordReplyDirect("user@test.com", `${TEST_DATE} Briefing`, new Date().toISOString(), "First");
    recordReplyDirect("user@test.com", `${TEST_DATE} Briefing`, new Date().toISOString(), "Second");
    recordReplyDirect("user@test.com", `${TEST_DATE} Briefing`, new Date().toISOString(), "Third");

    expect(existsSync(join(getResponsesDir(), "01-reply.md"))).toBe(true);
    expect(existsSync(join(getResponsesDir(), "02-reply.md"))).toBe(true);
    expect(existsSync(join(getResponsesDir(), "03-reply.md"))).toBe(true);

    const threadContent = readFileSync(join(getTestDir(), "thread.md"), "utf8");
    expect(threadContent).toContain("## NEW Reply #1");
    expect(threadContent).toContain("## NEW Reply #2");
    expect(threadContent).toContain("## NEW Reply #3");
  });

  test("saves Gmail Message-ID to .last-reply-id when provided", () => {
    const messageId = "<abc123@mail.gmail.com>";
    recordReplyDirect(
      "user@test.com",
      `${TEST_DATE} Briefing`,
      new Date().toISOString(),
      "Reply body",
      messageId
    );

    const lastReplyIdFile = join(getResponsesDir(), ".last-reply-id");
    expect(existsSync(lastReplyIdFile)).toBe(true);
    expect(readFileSync(lastReplyIdFile, "utf8")).toBe(messageId);
  });

  test("overwrites .last-reply-id with latest reply Message-ID", () => {
    recordReplyDirect("user@test.com", `${TEST_DATE} Briefing`, new Date().toISOString(), "First", "<first@gmail.com>");
    recordReplyDirect("user@test.com", `${TEST_DATE} Briefing`, new Date().toISOString(), "Second", "<second@gmail.com>");

    const lastReplyIdFile = join(getResponsesDir(), ".last-reply-id");
    expect(readFileSync(lastReplyIdFile, "utf8")).toBe("<second@gmail.com>");
  });

  test("does not create .last-reply-id when Message-ID not provided", () => {
    recordReplyDirect(
      "user@test.com",
      `${TEST_DATE} Briefing`,
      new Date().toISOString(),
      "Reply without Message-ID"
    );

    const lastReplyIdFile = join(getResponsesDir(), ".last-reply-id");
    expect(existsSync(lastReplyIdFile)).toBe(false);
  });
});

describe("isLockStale", () => {
  test("returns false for nonexistent file", () => {
    expect(isLockStale("/nonexistent/path")).toBe(false);
  });

  test("returns false for fresh lock", () => {
    const lockFile = getLockFile(TEST_DATE);
    writeFileSync(lockFile, new Date().toISOString());

    expect(isLockStale(lockFile)).toBe(false);
  });

  test("returns true for old lock", () => {
    const lockFile = getLockFile(TEST_DATE);
    writeFileSync(lockFile, "old");

    const oldTime = new Date(Date.now() - 15 * 60 * 1000);
    utimesSync(lockFile, oldTime, oldTime);

    expect(isLockStale(lockFile)).toBe(true);
  });

  test("respects custom stale threshold", () => {
    const lockFile = getLockFile(TEST_DATE);
    writeFileSync(lockFile, "test");

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    utimesSync(lockFile, fiveMinutesAgo, fiveMinutesAgo);

    // 10 minute threshold: not stale
    expect(isLockStale(lockFile, 10)).toBe(false);

    // 3 minute threshold: stale
    expect(isLockStale(lockFile, 3)).toBe(true);
  });
});

describe("cleanStaleLocks", () => {
  test("removes stale locks across dates", () => {
    const date2 = "2098-12-30";
    const dir2 = join(getReportsDir(), date2, "responses");
    mkdirSync(dir2, { recursive: true });

    // Create stale locks for both dates
    const lock1 = getLockFile(TEST_DATE);
    const lock2 = join(dir2, ".processing");
    writeFileSync(lock1, "stale1");
    writeFileSync(lock2, "stale2");

    const oldTime = new Date(Date.now() - 15 * 60 * 1000);
    utimesSync(lock1, oldTime, oldTime);
    utimesSync(lock2, oldTime, oldTime);

    cleanStaleLocks();

    expect(existsSync(lock1)).toBe(false);
    expect(existsSync(lock2)).toBe(false);

    // Cleanup
    rmSync(join(getReportsDir(), date2), { recursive: true, force: true });
  });

  test("preserves fresh locks", () => {
    const lockFile = getLockFile(TEST_DATE);
    writeFileSync(lockFile, new Date().toISOString());

    cleanStaleLocks();

    expect(existsSync(lockFile)).toBe(true);
  });
});

describe("integration: full reply cycle without race", () => {
  test("simulates multiple poll cycles with arriving replies", () => {
    // Poll 1: Reply arrives, triggers spawn
    recordReplyDirect("user@test.com", `${TEST_DATE} Briefing`, new Date().toISOString(), "Question 1");
    const r1 = triggerProcessing(TEST_DATE);
    expect(r1.triggered).toBe(true);
    expect(getSpawnCount()).toBe(1);

    // Poll 2: Another reply arrives while Claude running
    recordReplyDirect("user@test.com", `${TEST_DATE} Briefing`, new Date().toISOString(), "Question 2");
    const r2 = triggerProcessing(TEST_DATE);
    expect(r2.triggered).toBe(false);
    expect(r2.reason).toBe("lock_exists");
    expect(getSpawnCount()).toBe(1); // Still 1

    // Poll 3: Yet another reply, still blocked
    recordReplyDirect("user@test.com", `${TEST_DATE} Briefing`, new Date().toISOString(), "Question 3");
    const r3 = triggerProcessing(TEST_DATE);
    expect(r3.triggered).toBe(false);
    expect(getSpawnCount()).toBe(1); // Still 1

    // Claude finishes: writes response to highest reply, removes lock
    writeFileSync(join(getResponsesDir(), "03-response.md"), "Response to all 3 questions");
    removeLock(TEST_DATE);

    // Poll 4: No new replies, should not spawn
    const r4 = triggerProcessing(TEST_DATE);
    expect(r4.triggered).toBe(false);
    expect(r4.reason).toBe("no_unprocessed");
    expect(getSpawnCount()).toBe(1);

    // Poll 5: New reply arrives
    recordReplyDirect("user@test.com", `${TEST_DATE} Briefing`, new Date().toISOString(), "Follow-up question");
    const r5 = triggerProcessing(TEST_DATE);
    expect(r5.triggered).toBe(true);
    expect(getSpawnCount()).toBe(2); // Now 2

    // Total: exactly 2 spawns for 4 replies across 2 batches
  });
});
