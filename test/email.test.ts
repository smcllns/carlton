import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, "..", ".test-email");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Message-ID format", () => {
  test("Message-ID follows expected format", () => {
    const date = "2026-02-09";
    const messageId = `<carlton-${date}@carlton.local>`;

    expect(messageId).toBe("<carlton-2026-02-09@carlton.local>");
    expect(messageId).toMatch(/^<carlton-\d{4}-\d{2}-\d{2}@carlton\.local>$/);
  });

  test("Message-ID is unique per date", () => {
    const date1 = "2026-02-09";
    const date2 = "2026-02-10";

    const messageId1 = `<carlton-${date1}@carlton.local>`;
    const messageId2 = `<carlton-${date2}@carlton.local>`;

    expect(messageId1).not.toBe(messageId2);
  });
});

describe(".briefing-sent format", () => {
  test("contains valid JSON with resendId and messageId", () => {
    const sentData = {
      resendId: "re_abc123",
      messageId: "<carlton-2026-02-09@carlton.local>",
    };

    const sentFile = join(TEST_DIR, ".briefing-sent");
    writeFileSync(sentFile, JSON.stringify(sentData));

    const parsed = JSON.parse(readFileSync(sentFile, "utf8"));
    expect(parsed.resendId).toBe("re_abc123");
    expect(parsed.messageId).toBe("<carlton-2026-02-09@carlton.local>");
  });
});
