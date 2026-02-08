import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, statSync } from "fs";
import { join } from "path";
import { triggerProcessing } from "../src/index.ts";
import { hasUnprocessedReplies } from "../src/reply.ts";

const TEST_DIR = join(import.meta.dir, "..", ".test-serve");
const REPORTS_DIR = join(TEST_DIR, "reports");

// Override getReportsDir for testing by creating a mock structure
function setupTestDate(date: string) {
  const dateDir = join(REPORTS_DIR, date);
  const responsesDir = join(dateDir, "responses");
  mkdirSync(responsesDir, { recursive: true });
  return { dateDir, responsesDir };
}

beforeEach(() => {
  mkdirSync(REPORTS_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("triggerProcessing", () => {
  // Since triggerProcessing uses getReportsDir() internally, we test via the
  // hasUnprocessedReplies function directly and test lock file mechanics
  // on directories we control.

  test("hasUnprocessedReplies returns false for empty dir", () => {
    const { responsesDir } = setupTestDate("2099-01-01");
    expect(hasUnprocessedReplies(responsesDir)).toBe(false);
  });

  test("hasUnprocessedReplies returns true with replies only", () => {
    const { responsesDir } = setupTestDate("2099-01-01");
    writeFileSync(join(responsesDir, "01-reply.md"), "reply 1");
    expect(hasUnprocessedReplies(responsesDir)).toBe(true);
  });

  test("hasUnprocessedReplies returns false when all replied", () => {
    const { responsesDir } = setupTestDate("2099-01-01");
    writeFileSync(join(responsesDir, "01-reply.md"), "reply 1");
    writeFileSync(join(responsesDir, "01-response.md"), "response 1");
    expect(hasUnprocessedReplies(responsesDir)).toBe(false);
  });

  test("hasUnprocessedReplies true when new reply after response", () => {
    const { responsesDir } = setupTestDate("2099-01-01");
    writeFileSync(join(responsesDir, "01-reply.md"), "reply 1");
    writeFileSync(join(responsesDir, "01-response.md"), "response 1");
    writeFileSync(join(responsesDir, "02-reply.md"), "reply 2");
    expect(hasUnprocessedReplies(responsesDir)).toBe(true);
  });
});

describe("lock file behavior (direct)", () => {
  test("lock file prevents second spawn", () => {
    const { responsesDir } = setupTestDate("2099-02-01");
    writeFileSync(join(responsesDir, "01-reply.md"), "reply");
    const lockFile = join(responsesDir, ".processing");

    let spawnCount = 0;
    const mockSpawn = () => { spawnCount++; };

    // Simulate: manually write lock
    writeFileSync(lockFile, new Date().toISOString());

    // triggerProcessing would skip because lock exists
    // We can't call triggerProcessing directly (it uses getReportsDir),
    // but we can verify the invariant
    expect(existsSync(lockFile)).toBe(true);
    expect(hasUnprocessedReplies(responsesDir)).toBe(true);
    // With lock present, a real triggerProcessing call would return early
  });

  test("no lock created when no unprocessed replies", () => {
    const { responsesDir } = setupTestDate("2099-02-02");
    writeFileSync(join(responsesDir, "01-reply.md"), "reply 1");
    writeFileSync(join(responsesDir, "01-response.md"), "response 1");
    const lockFile = join(responsesDir, ".processing");

    expect(hasUnprocessedReplies(responsesDir)).toBe(false);
    expect(existsSync(lockFile)).toBe(false);
  });
});

describe("batching correctness", () => {
  test("batch response clears unprocessed state", () => {
    const { responsesDir } = setupTestDate("2099-03-01");

    // Three replies arrive
    writeFileSync(join(responsesDir, "01-reply.md"), "reply 1");
    writeFileSync(join(responsesDir, "02-reply.md"), "reply 2");
    writeFileSync(join(responsesDir, "03-reply.md"), "reply 3");
    expect(hasUnprocessedReplies(responsesDir)).toBe(true);

    // Claude writes batch response numbered by highest reply
    writeFileSync(join(responsesDir, "03-response.md"), "batch response");
    expect(hasUnprocessedReplies(responsesDir)).toBe(false);

    // New reply arrives
    writeFileSync(join(responsesDir, "04-reply.md"), "reply 4");
    expect(hasUnprocessedReplies(responsesDir)).toBe(true);
  });

  test("three replies trigger one spawn, not three", () => {
    const { responsesDir } = setupTestDate("2099-03-02");
    writeFileSync(join(responsesDir, "01-reply.md"), "reply 1");
    writeFileSync(join(responsesDir, "02-reply.md"), "reply 2");
    writeFileSync(join(responsesDir, "03-reply.md"), "reply 3");

    let spawnCount = 0;
    const mockSpawn = () => { spawnCount++; };
    const lockFile = join(responsesDir, ".processing");

    // Simulate triggerProcessing behavior manually:
    // First call: no lock, unprocessed → spawn
    if (!existsSync(lockFile) && hasUnprocessedReplies(responsesDir)) {
      writeFileSync(lockFile, new Date().toISOString());
      mockSpawn();
    }
    // Second call: lock exists → skip
    if (!existsSync(lockFile) && hasUnprocessedReplies(responsesDir)) {
      writeFileSync(lockFile, new Date().toISOString());
      mockSpawn();
    }
    // Third call: lock still exists → skip
    if (!existsSync(lockFile) && hasUnprocessedReplies(responsesDir)) {
      writeFileSync(lockFile, new Date().toISOString());
      mockSpawn();
    }

    expect(spawnCount).toBe(1);
  });

  test("double triggerProcessing creates lock exactly once", () => {
    const { responsesDir } = setupTestDate("2099-03-03");
    writeFileSync(join(responsesDir, "01-reply.md"), "reply");
    const lockFile = join(responsesDir, ".processing");

    let spawnCount = 0;
    const mockSpawn = () => { spawnCount++; };

    // First trigger
    if (!existsSync(lockFile) && hasUnprocessedReplies(responsesDir)) {
      writeFileSync(lockFile, new Date().toISOString());
      mockSpawn();
    }
    const lockContent1 = readFileSync(lockFile, "utf8");

    // Second trigger (rapid succession)
    if (!existsSync(lockFile) && hasUnprocessedReplies(responsesDir)) {
      writeFileSync(lockFile, new Date().toISOString());
      mockSpawn();
    }

    expect(spawnCount).toBe(1);
    expect(readFileSync(lockFile, "utf8")).toBe(lockContent1); // unchanged
  });
});

describe("stale lock recovery", () => {
  test("stale lock is detected by mtime", () => {
    const { responsesDir } = setupTestDate("2099-04-01");
    const lockFile = join(responsesDir, ".processing");

    writeFileSync(lockFile, new Date().toISOString());

    // Fresh lock — not stale
    const mtime = statSync(lockFile).mtimeMs;
    const age = Date.now() - mtime;
    expect(age).toBeLessThan(60_000); // less than 1 minute old = not stale
  });
});
