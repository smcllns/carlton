import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import {
  nextResponseNumber,
  buildThreadHistory,
  buildReplyContext,
  writeReplyFile,
  replyFilePaths,
} from "./reply.ts";

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

describe("nextResponseNumber", () => {
  test("returns 1 for empty directory", () => {
    expect(nextResponseNumber(TEST_DIR)).toBe(1);
  });

  test("returns 1 for nonexistent directory", () => {
    expect(nextResponseNumber(join(TEST_DIR, "nope"))).toBe(1);
  });

  test("increments based on existing reply files", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply 1");
    expect(nextResponseNumber(TEST_DIR)).toBe(2);

    writeFileSync(join(TEST_DIR, "02-reply.md"), "reply 2");
    expect(nextResponseNumber(TEST_DIR)).toBe(3);
  });

  test("ignores response and context files in count", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "reply");
    writeFileSync(join(TEST_DIR, "01-response.md"), "response");
    writeFileSync(join(TEST_DIR, "01-context.md"), "context");
    expect(nextResponseNumber(TEST_DIR)).toBe(2);
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

describe("buildThreadHistory", () => {
  test("returns empty string when no previous exchanges", () => {
    expect(buildThreadHistory(TEST_DIR, 1)).toBe("");
  });

  test("returns empty string for nonexistent directory", () => {
    expect(buildThreadHistory(join(TEST_DIR, "nope"), 1)).toBe("");
  });

  test("includes previous reply and response as exchange", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "Can you add shamrocks?");
    writeFileSync(join(TEST_DIR, "01-response.md"), "Sure, shamrocks added!");

    const history = buildThreadHistory(TEST_DIR, 2);
    expect(history).toContain("## Previous Exchanges");
    expect(history).toContain("### Exchange #1");
    expect(history).toContain("Can you add shamrocks?");
    expect(history).toContain("Sure, shamrocks added!");
  });

  test("excludes the current exchange", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "first reply");
    writeFileSync(join(TEST_DIR, "01-response.md"), "first response");
    writeFileSync(join(TEST_DIR, "02-reply.md"), "second reply");

    const history = buildThreadHistory(TEST_DIR, 2);
    expect(history).toContain("first reply");
    expect(history).not.toContain("second reply");
  });

  test("handles multiple exchanges in order", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "first question");
    writeFileSync(join(TEST_DIR, "01-response.md"), "first answer");
    writeFileSync(join(TEST_DIR, "02-reply.md"), "second question");
    writeFileSync(join(TEST_DIR, "02-response.md"), "second answer");

    const history = buildThreadHistory(TEST_DIR, 3);
    expect(history).toContain("### Exchange #1");
    expect(history).toContain("### Exchange #2");
    const idx1 = history.indexOf("Exchange #1");
    const idx2 = history.indexOf("Exchange #2");
    expect(idx1).toBeLessThan(idx2);
  });

  test("handles missing response file (reply without response yet)", () => {
    writeFileSync(join(TEST_DIR, "01-reply.md"), "question");
    // no 01-response.md

    const history = buildThreadHistory(TEST_DIR, 2);
    expect(history).toContain("Exchange #1");
    expect(history).toContain("question");
  });
});

describe("buildReplyContext", () => {
  const meta = {
    from: "sam@test.com",
    subject: "Re: Carlton: 2026-02-09 Meeting Briefing",
    date: "2026-02-09T10:00:00",
    account: "sam@test.com",
    threadId: "thread123",
    messageId: "msg456",
    briefingDate: "2026-02-09",
  };

  const files = {
    replyFile: "reports/2026-02-09/responses/01-reply.md",
    responseFile: "reports/2026-02-09/responses/01-response.md",
    contextFile: "reports/2026-02-09/responses/01-context.md",
  };

  test("includes reply content", () => {
    const ctx = buildReplyContext(meta, "Add shamrock emojis please", "", files);
    expect(ctx).toContain("Add shamrock emojis please");
  });

  test("includes thread history when provided", () => {
    const history = "## Previous Exchanges\n\n### Exchange #1\n**User:** hi\n**Carlton:** hello\n\n";
    const ctx = buildReplyContext(meta, "follow up", history, files);
    expect(ctx).toContain("## Previous Exchanges");
    expect(ctx).toContain("Exchange #1");
  });

  test("includes response file path for Claude to write to", () => {
    const ctx = buildReplyContext(meta, "test", "", files);
    expect(ctx).toContain("Write your response to: reports/2026-02-09/responses/01-response.md");
  });

  test("includes reply-to command with correct subject", () => {
    const ctx = buildReplyContext(meta, "test", "", files);
    expect(ctx).toContain('bun carlton reply-to "Re: Carlton: 2026-02-09 Meeting Briefing"');
  });

  test("memory instructions specify preference category only", () => {
    const ctx = buildReplyContext(meta, "test", "", files);
    expect(ctx).toContain("USER PREFERENCES");
    expect(ctx).toContain("preference:");
    expect(ctx).toContain("Do NOT log process observations");
  });

  test("data files section references correct date", () => {
    const ctx = buildReplyContext(meta, "test", "", files);
    expect(ctx).toContain("reports/2026-02-09/");
  });
});

describe("reply file structure", () => {
  test("all files for an exchange live in the same directory", () => {
    const responsesDir = join(TEST_DIR, "responses");
    mkdirSync(responsesDir, { recursive: true });

    const paths = replyFilePaths(responsesDir, 1);
    writeReplyFile(paths.replyFile, 1, "sam@test.com", "2026-02-09", "Re: Briefing", "test body");
    writeFileSync(paths.contextFile, buildReplyContext(
      { from: "sam@test.com", subject: "Re: Briefing", date: "2026-02-09", account: "sam@test.com", threadId: "t1", messageId: "m1", briefingDate: "2026-02-09" },
      "test body", "", paths
    ));

    const files = readdirSync(responsesDir);
    expect(files).toContain("01-reply.md");
    expect(files).toContain("01-context.md");
    // 01-response.md is written by the spawned Claude, not by us
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
