import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, statSync } from "fs";
import { join } from "path";
import { triggerProcessing } from "../src/index.ts";
import { hasUnprocessedReplies } from "../src/reply.ts";

const TEST_DIR = join(import.meta.dir, "..", ".test-serve");
const REPORTS_DIR = join(TEST_DIR, "reports");

function setupTestDate(date: string) {
  const dateDir = join(REPORTS_DIR, date);
  const responsesDir = join(dateDir, "responses");
  mkdirSync(responsesDir, { recursive: true });
  writeFileSync(join(dateDir, "thread.md"), `# Carlton Thread — ${date}\n`);
  return { dateDir, responsesDir };
}

beforeEach(() => {
  mkdirSync(REPORTS_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("triggerProcessing", () => {
  test("creates lock and spawns when unprocessed replies exist", () => {
    const { responsesDir } = setupTestDate("2099-01-01");
    writeFileSync(join(responsesDir, "01-reply.md"), "reply");

    let spawnCalled = false;
    triggerProcessing("2099-01-01", {
      spawnFn: () => { spawnCalled = true; },
      reportsDir: REPORTS_DIR,
    });

    expect(existsSync(join(responsesDir, ".processing"))).toBe(true);
    expect(spawnCalled).toBe(true);
  });

  test("skips when lock already exists", () => {
    const { responsesDir } = setupTestDate("2099-01-02");
    writeFileSync(join(responsesDir, "01-reply.md"), "reply");
    writeFileSync(join(responsesDir, ".processing"), "locked");

    let spawnCalled = false;
    triggerProcessing("2099-01-02", {
      spawnFn: () => { spawnCalled = true; },
      reportsDir: REPORTS_DIR,
    });

    expect(spawnCalled).toBe(false);
  });

  test("skips when no thread.md (pre-redesign date)", () => {
    const dateDir = join(REPORTS_DIR, "2099-01-10");
    const responsesDir = join(dateDir, "responses");
    mkdirSync(responsesDir, { recursive: true });
    writeFileSync(join(responsesDir, "01-reply.md"), "reply");

    let spawnCalled = false;
    triggerProcessing("2099-01-10", {
      spawnFn: () => { spawnCalled = true; },
      reportsDir: REPORTS_DIR,
    });

    expect(spawnCalled).toBe(false);
    expect(existsSync(join(responsesDir, ".processing"))).toBe(false);
  });

  test("skips when no unprocessed replies", () => {
    const { responsesDir } = setupTestDate("2099-01-03");
    writeFileSync(join(responsesDir, "01-reply.md"), "reply");
    writeFileSync(join(responsesDir, "01-response.md"), "response");

    let spawnCalled = false;
    triggerProcessing("2099-01-03", {
      spawnFn: () => { spawnCalled = true; },
      reportsDir: REPORTS_DIR,
    });

    expect(existsSync(join(responsesDir, ".processing"))).toBe(false);
    expect(spawnCalled).toBe(false);
  });

  test("cleans up lock if spawn throws", () => {
    const { responsesDir } = setupTestDate("2099-01-04");
    writeFileSync(join(responsesDir, "01-reply.md"), "reply");

    expect(() => {
      triggerProcessing("2099-01-04", {
        spawnFn: () => { throw new Error("spawn failed"); },
        reportsDir: REPORTS_DIR,
      });
    }).toThrow("spawn failed");

    expect(existsSync(join(responsesDir, ".processing"))).toBe(false);
  });

  test("double call creates lock exactly once, spawns exactly once", () => {
    const { responsesDir } = setupTestDate("2099-01-05");
    writeFileSync(join(responsesDir, "01-reply.md"), "reply");

    let spawnCount = 0;
    const opts = {
      spawnFn: () => { spawnCount++; },
      reportsDir: REPORTS_DIR,
    };

    triggerProcessing("2099-01-05", opts);
    triggerProcessing("2099-01-05", opts);

    expect(spawnCount).toBe(1);
  });

  test("three replies trigger one spawn, not three", () => {
    const { responsesDir } = setupTestDate("2099-01-06");
    writeFileSync(join(responsesDir, "01-reply.md"), "reply 1");
    writeFileSync(join(responsesDir, "02-reply.md"), "reply 2");
    writeFileSync(join(responsesDir, "03-reply.md"), "reply 3");

    let spawnCount = 0;
    const opts = {
      spawnFn: () => { spawnCount++; },
      reportsDir: REPORTS_DIR,
    };

    triggerProcessing("2099-01-06", opts);
    triggerProcessing("2099-01-06", opts);
    triggerProcessing("2099-01-06", opts);

    expect(spawnCount).toBe(1);
  });
});

describe("batching correctness", () => {
  test("batch response clears unprocessed state", () => {
    const { responsesDir } = setupTestDate("2099-03-01");

    writeFileSync(join(responsesDir, "01-reply.md"), "reply 1");
    writeFileSync(join(responsesDir, "02-reply.md"), "reply 2");
    writeFileSync(join(responsesDir, "03-reply.md"), "reply 3");
    expect(hasUnprocessedReplies(responsesDir)).toBe(true);

    writeFileSync(join(responsesDir, "03-response.md"), "batch response");
    expect(hasUnprocessedReplies(responsesDir)).toBe(false);

    writeFileSync(join(responsesDir, "04-reply.md"), "reply 4");
    expect(hasUnprocessedReplies(responsesDir)).toBe(true);
  });

  test("batch flow: spawn → response → new reply → spawn again", () => {
    const { responsesDir } = setupTestDate("2099-03-02");
    writeFileSync(join(responsesDir, "01-reply.md"), "reply 1");
    writeFileSync(join(responsesDir, "02-reply.md"), "reply 2");
    writeFileSync(join(responsesDir, "03-reply.md"), "reply 3");

    let spawnCount = 0;
    const opts = {
      spawnFn: () => { spawnCount++; },
      reportsDir: REPORTS_DIR,
    };

    // First trigger: spawn
    triggerProcessing("2099-03-02", opts);
    expect(spawnCount).toBe(1);

    // Simulate Claude writing response and removing lock
    writeFileSync(join(responsesDir, "03-response.md"), "batch response");
    rmSync(join(responsesDir, ".processing"));

    // No unprocessed → no spawn
    triggerProcessing("2099-03-02", opts);
    expect(spawnCount).toBe(1);

    // New reply arrives
    writeFileSync(join(responsesDir, "04-reply.md"), "reply 4");
    triggerProcessing("2099-03-02", opts);
    expect(spawnCount).toBe(2);
  });
});

describe("stale lock recovery", () => {
  test("fresh lock is not stale", () => {
    const { responsesDir } = setupTestDate("2099-04-01");
    const lockFile = join(responsesDir, ".processing");

    writeFileSync(lockFile, new Date().toISOString());

    const mtime = statSync(lockFile).mtimeMs;
    const age = Date.now() - mtime;
    expect(age).toBeLessThan(60_000);
  });
});
