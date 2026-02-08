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

describe("append ordering", () => {
  test("sections appear in correct chronological order", () => {
    const threadFile = join(TEST_DIR, "thread.md");

    // Create with briefing
    writeFileSync(threadFile, `# Carlton Thread — 2026-02-09

## Briefing Sent (2026-02-09 05:00 GMT)

Morning briefing content.

---
`);

    // Append reply #1
    appendToThread(threadFile, "NEW Reply #1 (2026-02-09 10:15 from sam@test.com)", "What time is the standup?");

    // Append response
    appendToThread(threadFile, "Response to Reply #1", "The standup is at 9:00 AM.");

    // Append reply #2
    appendToThread(threadFile, "NEW Reply #2 (2026-02-09 14:30 from sam@test.com)", "Thanks!");

    const content = readFileSync(threadFile, "utf8");

    // Check order
    const briefingIdx = content.indexOf("## Briefing Sent");
    const reply1Idx = content.indexOf("## NEW Reply #1");
    const responseIdx = content.indexOf("## Response to Reply #1");
    const reply2Idx = content.indexOf("## NEW Reply #2");

    expect(briefingIdx).toBeLessThan(reply1Idx);
    expect(reply1Idx).toBeLessThan(responseIdx);
    expect(responseIdx).toBeLessThan(reply2Idx);
  });

  test("special characters in email body do not corrupt file", () => {
    const threadFile = join(TEST_DIR, "thread.md");

    writeFileSync(threadFile, "# Thread\n\n---\n");

    // Email with special characters
    const specialContent = `Here's some "quoted text" with \`backticks\` and ## headers

\`\`\`code
const x = 1;
\`\`\`

And some > quoted lines
> like this

Plus unicode: 🎉 émoji`;

    appendToThread(threadFile, "NEW Reply #1", specialContent);

    const content = readFileSync(threadFile, "utf8");

    expect(content).toContain('Here\'s some "quoted text"');
    expect(content).toContain("`backticks`");
    expect(content).toContain("```code");
    expect(content).toContain("🎉");
    expect(content).toContain("émoji");
  });
});

describe("NEW marker lifecycle", () => {
  test("append adds NEW marker", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    writeFileSync(threadFile, "# Thread\n\n---\n");

    appendToThread(threadFile, "NEW Reply #1 (2026-02-09 from user@test.com)", "Hello");

    const content = readFileSync(threadFile, "utf8");
    expect(content).toContain("## NEW Reply #1");
  });

  test("removeNewMarkers removes NEW from header", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    writeFileSync(threadFile, "# Thread\n\n## NEW Reply #1\n\nContent\n\n---\n");

    removeNewMarkers(threadFile);

    const content = readFileSync(threadFile, "utf8");
    expect(content).toContain("## Reply #1");
    expect(content).not.toContain("## NEW Reply");
    expect(content).toContain("Content");
  });

  test("multiple NEW markers removed in one pass", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    writeFileSync(threadFile, `# Thread

## Briefing

Content

---

## NEW Reply #1

Reply 1

---

## NEW Reply #2

Reply 2

---

## NEW Reply #3

Reply 3

---
`);

    removeNewMarkers(threadFile);

    const content = readFileSync(threadFile, "utf8");
    expect(content).toContain("## Reply #1");
    expect(content).toContain("## Reply #2");
    expect(content).toContain("## Reply #3");
    expect(content).not.toContain("NEW");

    // Content preserved
    expect(content).toContain("Reply 1");
    expect(content).toContain("Reply 2");
    expect(content).toContain("Reply 3");
  });
});

describe("concurrent appends (simulated)", () => {
  test("two rapid appends both appear in file", () => {
    const threadFile = join(TEST_DIR, "thread.md");
    writeFileSync(threadFile, "# Thread\n\n---\n");

    // Simulate two rapid appends
    appendToThread(threadFile, "NEW Reply #1", "First message");
    appendToThread(threadFile, "NEW Reply #2", "Second message");

    const content = readFileSync(threadFile, "utf8");
    expect(content).toContain("## NEW Reply #1");
    expect(content).toContain("First message");
    expect(content).toContain("## NEW Reply #2");
    expect(content).toContain("Second message");
  });
});

describe("thread.md format", () => {
  test("follows expected structure", () => {
    const threadFile = join(TEST_DIR, "thread.md");

    // Create initial thread with briefing
    const initialContent = `# Carlton Thread — 2026-02-09

## Briefing Sent (2026-02-08 05:00 GMT)

Here's your morning briefing.

---
`;
    writeFileSync(threadFile, initialContent);

    // Add a reply
    appendToThread(threadFile, "NEW Reply #1 (2026-02-09 10:15 from sam@test.com)", "What's on the agenda?");

    // Add response
    appendToThread(threadFile, "Response to Reply #1", "The agenda includes...");

    const content = readFileSync(threadFile, "utf8");

    // Structure checks
    expect(content).toMatch(/^# Carlton Thread/);
    expect(content).toContain("## Briefing Sent");
    expect(content).toContain("## NEW Reply #1");
    expect(content).toContain("## Response to Reply #1");
    expect(content.match(/---/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
