import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import {
  maxReplyNumber,
  maxResponseNumber,
  hasUnprocessedReplies,
  nextReplyNumber,
  writeReplyFile,
  replyFilePaths,
  appendToThread,
  removeNewMarkers,
  buildReplyPrompt,
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

  test("returns 1 for one reply", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply 1");
    expect(maxReplyNumber(TEST_DIR)).toBe(1);
  });

  test("handles gaps in numbering (01, 03) → 3", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply 1");
    writeFileSync(join(TEST_DIR, "03-reply.md"), "reply 3");
    expect(maxReplyNumber(TEST_DIR)).toBe(3);
  });

  test("ignores response files", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply");
    writeFileSync(join(TEST_DIR, "01-response.md"), "response");
    expect(maxReplyNumber(TEST_DIR)).toBe(1);
  });
});

describe("maxResponseNumber", () => {
  test("returns 0 for empty directory", () => {
    expect(maxResponseNumber(TEST_DIR)).toBe(0);
  });

  test("returns 0 for nonexistent directory", () => {
    expect(maxResponseNumber(join(TEST_DIR, "nope"))).toBe(0);
  });

  test("returns 1 for one response", () => {
    writeFileSync(join(TEST_DIR, "01-response.md"), "response 1");
    expect(maxResponseNumber(TEST_DIR)).toBe(1);
  });

  test("handles gaps correctly", () => {
    writeFileSync(join(TEST_DIR, "01-response.md"), "response 1");
    writeFileSync(join(TEST_DIR, "03-response.md"), "response 3");
    expect(maxResponseNumber(TEST_DIR)).toBe(3);
  });

  test("ignores reply files", () => {
    writeFileSync(join(TEST_DIR, "02-reply.md"), "reply");
    writeFileSync(join(TEST_DIR, "02-response.md"), "response");
    expect(maxResponseNumber(TEST_DIR)).toBe(2);
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
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply");
    expect(hasUnprocessedReplies(TEST_DIR)).toBe(true);
  });

  test("returns false when all replies have responses", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply");
    writeFileSync(join(TEST_DIR, "01-response.md"), "response");
    expect(hasUnprocessedReplies(TEST_DIR)).toBe(false);
  });

  test("returns true when new reply arrives after last response", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply 1");
    writeFileSync(join(TEST_DIR, "01-response.md"), "response 1");
    writeFileSync(join(TEST_DIR, "02-reply.md"), "reply 2");
    expect(hasUnprocessedReplies(TEST_DIR)).toBe(true);
  });

  test("handles batch response (response numbered by highest reply)", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply 1");
    writeFileSync(join(TEST_DIR, "02-reply.md"), "reply 2");
    writeFileSync(join(TEST_DIR, "03-reply.md"), "reply 3");
    writeFileSync(join(TEST_DIR, "03-response.md"), "batch response");
    expect(hasUnprocessedReplies(TEST_DIR)).toBe(false);
  });
});

describe("nextReplyNumber", () => {
  test("returns 1 for empty directory", () => {
    expect(nextReplyNumber(TEST_DIR)).toBe(1);
  });

  test("returns max reply + 1", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply");
    writeFileSync(join(TEST_DIR, "02-reply.md"), "reply");
    expect(nextReplyNumber(TEST_DIR)).toBe(3);
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
  test("creates file if missing", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    appendToThread(threadFile, "Reply #1", "Hello");
    expect(existsSync(threadFile)).toBe(true);
    const content = readFileSync(threadFile, "utf8");
    expect(content).toContain("## Reply #1");
    expect(content).toContain("Hello");
  });

  test("creates parent directories if missing", () => {
    const threadFile = join(TEST_DIR, "nested", "deep", "thread.md");
    appendToThread(threadFile, "Reply #1", "Hello");
    expect(existsSync(threadFile)).toBe(true);
  });

  test("appends to existing file", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    writeFileSync(threadFile, "# Thread\n\nBriefing content\n");
    appendToThread(threadFile, "Reply #1", "First reply");
    appendToThread(threadFile, "Response", "First response");
    const content = readFileSync(threadFile, "utf8");
    expect(content).toContain("# Thread");
    expect(content).toContain("## Reply #1");
    expect(content).toContain("First reply");
    expect(content).toContain("## Response");
    expect(content).toContain("First response");
  });

  test("maintains chronological ordering", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    writeFileSync(threadFile, "# Thread\n");
    appendToThread(threadFile, "Reply #1", "first");
    appendToThread(threadFile, "Response", "response to first");
    appendToThread(threadFile, "Reply #2", "second");
    const content = readFileSync(threadFile, "utf8");
    const idx1 = content.indexOf("Reply #1");
    const idxR = content.indexOf("Response");
    const idx2 = content.indexOf("Reply #2");
    expect(idx1).toBeLessThan(idxR);
    expect(idxR).toBeLessThan(idx2);
  });

  test("handles special characters in content", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    appendToThread(threadFile, "Reply #1", 'Content with "quotes", `backticks`, and ## markdown headers');
    const content = readFileSync(threadFile, "utf8");
    expect(content).toContain('"quotes"');
    expect(content).toContain("`backticks`");
    expect(content).toContain("## markdown headers");
  });

  test("concurrent appends both appear", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    writeFileSync(threadFile, "# Thread\n");
    // Simulate rapid sequential appends (Node/Bun is single-threaded so true concurrent is unnecessary)
    appendToThread(threadFile, "Reply #1", "first");
    appendToThread(threadFile, "Reply #2", "second");
    const content = readFileSync(threadFile, "utf8");
    expect(content).toContain("Reply #1");
    expect(content).toContain("Reply #2");
    expect(content).toContain("first");
    expect(content).toContain("second");
  });
});

describe("removeNewMarkers", () => {
  test("removes NEW prefix from reply headers", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    writeFileSync(threadFile, "## NEW Reply #1 (2026-02-08 from sam@test.com)\n\nHello\n");
    removeNewMarkers(threadFile);
    const content = readFileSync(threadFile, "utf8");
    expect(content).toContain("## Reply #1");
    expect(content).not.toContain("NEW");
  });

  test("leaves non-NEW sections untouched", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    writeFileSync(threadFile, "## Briefing Sent\n\ncontent\n\n## Reply #1\n\nold reply\n\n## NEW Reply #2\n\nnew reply\n");
    removeNewMarkers(threadFile);
    const content = readFileSync(threadFile, "utf8");
    expect(content).toContain("## Briefing Sent");
    expect(content).toContain("## Reply #1");
    expect(content).toContain("## Reply #2");
    expect(content).not.toContain("NEW");
  });

  test("handles multiple NEW markers in one pass", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    writeFileSync(threadFile, "## NEW Reply #2\n\nsecond\n\n## NEW Reply #3\n\nthird\n");
    removeNewMarkers(threadFile);
    const content = readFileSync(threadFile, "utf8");
    expect(content).toContain("## Reply #2");
    expect(content).toContain("## Reply #3");
    expect(content).not.toContain("NEW");
    expect(content).toContain("second");
    expect(content).toContain("third");
  });

  test("no-op if no NEW markers", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    const original = "## Reply #1\n\ncontent\n";
    writeFileSync(threadFile, original);
    removeNewMarkers(threadFile);
    expect(readFileSync(threadFile, "utf8")).toBe(original);
  });

  test("no-op for nonexistent file", () => {
    removeNewMarkers(join(TEST_DIR, "nonexistent.md"));
    // should not throw
  });
});

describe("buildReplyPrompt", () => {
  test("throws when thread.md is missing", () => {
    expect(() => buildReplyPrompt("2099-01-01")).toThrow("No thread.md found");
  });
});
