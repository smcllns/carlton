import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import {
  nextReplyNumber,
  writeReplyFile,
  replyFilePaths,
  maxReplyNumber,
  maxResponseNumber,
  hasUnprocessedReplies,
  appendToThread,
} from "../src/reply.ts";

const TEST_DIR = join(import.meta.dir, "..", ".test-replies");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("replyFilePaths", () => {
  test("files live in responses dir, not project root", () => {
    const paths = replyFilePaths(join(TEST_DIR, "responses"), 3);
    expect(paths.replyFile).toContain("responses/03-reply.md");
    expect(paths.responseFile).toContain("responses/03-response.md");
    expect(paths.contextFile).toContain("responses/03-context.md");
  });

  test("zero-pads single digit numbers", () => {
    const paths = replyFilePaths(TEST_DIR, 1);
    expect(paths.replyFile).toEndWith("01-reply.md");
  });

  test("handles double digit numbers", () => {
    const paths = replyFilePaths(TEST_DIR, 12);
    expect(paths.replyFile).toEndWith("12-reply.md");
  });
});

describe("maxReplyNumber", () => {
  test("returns 0 for empty directory", () => {
    expect(maxReplyNumber(TEST_DIR)).toBe(0);
  });

  test("returns 0 for nonexistent directory", () => {
    expect(maxReplyNumber(join(TEST_DIR, "nope"))).toBe(0);
  });

  test("returns 1 for one reply file", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply 1");
    expect(maxReplyNumber(TEST_DIR)).toBe(1);
  });

  test("returns highest number with gaps in numbering", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply 1");
    writeFileSync(join(TEST_DIR, "03-reply.md"), "reply 3");
    expect(maxReplyNumber(TEST_DIR)).toBe(3);
  });
});

describe("maxResponseNumber", () => {
  test("returns 0 for empty directory", () => {
    expect(maxResponseNumber(TEST_DIR)).toBe(0);
  });

  test("returns 0 for nonexistent directory", () => {
    expect(maxResponseNumber(join(TEST_DIR, "nope"))).toBe(0);
  });

  test("returns 1 for one response file", () => {
    writeFileSync(join(TEST_DIR, "01-response.md"), "response 1");
    expect(maxResponseNumber(TEST_DIR)).toBe(1);
  });

  test("returns highest number with gaps in numbering", () => {
    writeFileSync(join(TEST_DIR, "01-response.md"), "response 1");
    writeFileSync(join(TEST_DIR, "03-response.md"), "response 3");
    expect(maxResponseNumber(TEST_DIR)).toBe(3);
  });
});

describe("hasUnprocessedReplies", () => {
  test("returns false for empty directory", () => {
    expect(hasUnprocessedReplies(TEST_DIR)).toBe(false);
  });

  test("returns false for nonexistent directory", () => {
    expect(hasUnprocessedReplies(join(TEST_DIR, "nope"))).toBe(false);
  });

  test("returns true when replies exist but no responses", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply 1");
    expect(hasUnprocessedReplies(TEST_DIR)).toBe(true);
  });

  test("returns false when all replies have responses", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply 1");
    writeFileSync(join(TEST_DIR, "01-response.md"), "response 1");
    expect(hasUnprocessedReplies(TEST_DIR)).toBe(false);
  });

  test("returns true when new reply arrives after last response", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply 1");
    writeFileSync(join(TEST_DIR, "01-response.md"), "response 1");
    writeFileSync(join(TEST_DIR, "02-reply.md"), "reply 2");
    expect(hasUnprocessedReplies(TEST_DIR)).toBe(true);
  });
});

describe("nextReplyNumber", () => {
  test("returns 1 for empty directory", () => {
    expect(nextReplyNumber(TEST_DIR)).toBe(1);
  });

  test("returns 1 for nonexistent directory", () => {
    expect(nextReplyNumber(join(TEST_DIR, "nope"))).toBe(1);
  });

  test("increments based on existing reply files", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply 1");
    expect(nextReplyNumber(TEST_DIR)).toBe(2);

    writeFileSync(join(TEST_DIR, "02-reply.md"), "reply 2");
    expect(nextReplyNumber(TEST_DIR)).toBe(3);
  });

  test("handles gaps in numbering", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply 1");
    writeFileSync(join(TEST_DIR, "03-reply.md"), "reply 3");
    expect(nextReplyNumber(TEST_DIR)).toBe(4);
  });

  test("ignores response and context files", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply");
    writeFileSync(join(TEST_DIR, "01-response.md"), "response");
    writeFileSync(join(TEST_DIR, "01-context.md"), "context");
    expect(nextReplyNumber(TEST_DIR)).toBe(2);
  });
});

describe("writeReplyFile", () => {
  test("creates reply file with metadata and body", () => {
    const file = join(TEST_DIR, "01-reply.md");
    writeReplyFile(file, 1, "sam@test.com", "2026-02-09", "Re: Briefing", "What about shamrocks?");

    const content = readFileSync(file, "utf8");
    expect(content).toContain("# User Reply #1");
    expect(content).toContain("**From:** sam@test.com");
    expect(content).toContain("**Subject:** Re: Briefing");
    expect(content).toContain("What about shamrocks?");
  });
});

describe("appendToThread", () => {
  test("appends to existing file", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    writeFileSync(threadFile, "# Thread\n\n## Briefing\n\nContent\n\n---\n");

    appendToThread(threadFile, "Reply #1", "Hello there!");

    const content = readFileSync(threadFile, "utf8");
    expect(content).toContain("# Thread");
    expect(content).toContain("## Reply #1");
    expect(content).toContain("Hello there!");
  });

  test("creates file if missing", () => {
    const threadFile = join(TEST_DIR, "thread.md");

    appendToThread(threadFile, "Reply #1", "First message");

    expect(existsSync(threadFile)).toBe(true);
    const content = readFileSync(threadFile, "utf8");
    expect(content).toContain("## Reply #1");
    expect(content).toContain("First message");
  });
});

describe("reply file structure", () => {
  test("all files for an exchange live in the same directory", () => {
    const responsesDir = join(TEST_DIR, "responses");
    mkdirSync(responsesDir, { recursive: true });

    const paths = replyFilePaths(responsesDir, 1);
    writeReplyFile(paths.replyFile, 1, "sam@test.com", "2026-02-09", "Re: Briefing", "test body");
    writeFileSync(paths.contextFile, "context content");

    const files = readdirSync(responsesDir);
    expect(files).toContain("01-reply.md");
    expect(files).toContain("01-context.md");
  });

  test("no files created in project root", () => {
    const responsesDir = join(TEST_DIR, "responses");
    mkdirSync(responsesDir, { recursive: true });

    const paths = replyFilePaths(responsesDir, 1);
    writeReplyFile(paths.replyFile, 1, "sam@test.com", "2026-02-09", "Re: Briefing", "test");
    writeFileSync(paths.contextFile, "context content");

    const rootFiles = readdirSync(TEST_DIR).filter(f => f.startsWith(".carlton-reply"));
    expect(rootFiles).toHaveLength(0);
  });
});
