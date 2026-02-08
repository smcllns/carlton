import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { appendToThread, removeNewMarkers } from "../src/reply.ts";

const TEST_DIR = join(import.meta.dir, "..", ".test-thread");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("thread.md append ordering", () => {
  test("sections appear in correct chronological order", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    writeFileSync(threadFile, "# Carlton Thread — 2026-02-09\n\n## Briefing Sent\n\nBriefing content here\n");

    appendToThread(threadFile, "NEW Reply #1 (2026-02-09T10:15 from sam@test.com)", "What's the agenda?");
    appendToThread(threadFile, "Response", "The agenda is...");
    appendToThread(threadFile, "NEW Reply #2 (2026-02-09T14:30 from sam@test.com)", "Thanks, one more question");

    const content = readFileSync(threadFile, "utf8");
    const idxBriefing = content.indexOf("Briefing Sent");
    const idxReply1 = content.indexOf("Reply #1");
    const idxResponse = content.indexOf("## Response");
    const idxReply2 = content.indexOf("Reply #2");

    expect(idxBriefing).toBeLessThan(idxReply1);
    expect(idxReply1).toBeLessThan(idxResponse);
    expect(idxResponse).toBeLessThan(idxReply2);
  });

  test("special characters in email body don't corrupt file", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    writeFileSync(threadFile, "# Thread\n");

    const specialContent = [
      'Here are some "quoted" words',
      "```code block```",
      "## This looks like a heading in the body",
      "Line with | pipes | and --- dashes",
      "Backticks: `foo`, triple: ```bar```",
      "Unicode: 🦸🍩✅❌",
    ].join("\n");

    appendToThread(threadFile, "Reply #1", specialContent);

    const content = readFileSync(threadFile, "utf8");
    expect(content).toContain('"quoted"');
    expect(content).toContain("```code block```");
    expect(content).toContain("## This looks like a heading in the body");
    expect(content).toContain("| pipes |");
    expect(content).toContain("🦸🍩✅❌");
  });
});

describe("NEW marker lifecycle", () => {
  test("append NEW → remove → append more NEW → remove all", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    writeFileSync(threadFile, "# Thread\n");

    // Step 1: append NEW Reply #1
    appendToThread(threadFile, "NEW Reply #1 (time from user)", "First question");
    let content = readFileSync(threadFile, "utf8");
    expect(content).toContain("## NEW Reply #1");

    // Step 2: remove NEW markers
    removeNewMarkers(threadFile);
    content = readFileSync(threadFile, "utf8");
    expect(content).toContain("## Reply #1");
    expect(content).not.toContain("NEW");

    // Step 3: append NEW Reply #2 and NEW Reply #3
    appendToThread(threadFile, "NEW Reply #2 (time from user)", "Second question");
    appendToThread(threadFile, "NEW Reply #3 (time from user)", "Third question");
    content = readFileSync(threadFile, "utf8");
    expect(content).toContain("## NEW Reply #2");
    expect(content).toContain("## NEW Reply #3");

    // Step 4: remove all NEW markers
    removeNewMarkers(threadFile);
    content = readFileSync(threadFile, "utf8");
    expect(content).toContain("## Reply #2");
    expect(content).toContain("## Reply #3");
    expect(content).not.toContain("NEW");

    // Verify content preserved
    expect(content).toContain("First question");
    expect(content).toContain("Second question");
    expect(content).toContain("Third question");
  });

  test("removeNewMarkers is idempotent", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    writeFileSync(threadFile, "## Reply #1\n\ncontent\n");

    removeNewMarkers(threadFile);
    const content1 = readFileSync(threadFile, "utf8");
    removeNewMarkers(threadFile);
    const content2 = readFileSync(threadFile, "utf8");
    expect(content1).toBe(content2);
  });
});

describe("concurrent appends", () => {
  test("two rapid appends both appear in file", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    writeFileSync(threadFile, "# Thread\n");

    appendToThread(threadFile, "NEW Reply #1", "fast one");
    appendToThread(threadFile, "NEW Reply #2", "fast two");

    const content = readFileSync(threadFile, "utf8");
    expect(content).toContain("Reply #1");
    expect(content).toContain("Reply #2");
    expect(content).toContain("fast one");
    expect(content).toContain("fast two");
  });
});
