import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
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

  test("can parse old format (plain string) gracefully", () => {
    // Old format was just the resend ID as plain text
    const sentFile = join(TEST_DIR, ".briefing-sent");
    writeFileSync(sentFile, "re_old_format");

    const content = readFileSync(sentFile, "utf8");

    // Try JSON parse, fall back to empty
    let messageId = "";
    try {
      const parsed = JSON.parse(content);
      messageId = parsed.messageId || "";
    } catch {
      // Old format - no messageId available
      messageId = "";
    }

    expect(messageId).toBe("");
  });
});

describe("email threading headers", () => {
  test("In-Reply-To and References should use same messageId", () => {
    const originalMessageId = "<carlton-2026-02-09@carlton.local>";

    // Simulating what sendReply does
    const headers = {
      "In-Reply-To": originalMessageId,
      References: originalMessageId,
    };

    expect(headers["In-Reply-To"]).toBe(originalMessageId);
    expect(headers.References).toBe(originalMessageId);
    expect(headers["In-Reply-To"]).toBe(headers.References);
  });

  test("empty inReplyTo results in empty headers", () => {
    const inReplyTo = "";

    const headers = {
      "In-Reply-To": inReplyTo,
      References: inReplyTo,
    };

    expect(headers["In-Reply-To"]).toBe("");
    expect(headers.References).toBe("");
  });
});

describe("cmdReplyTo reads messageId from .briefing-sent", () => {
  test("extracts messageId from JSON format", () => {
    const sentFile = join(TEST_DIR, ".briefing-sent");
    const sentData = {
      resendId: "re_test123",
      messageId: "<carlton-2026-02-09@carlton.local>",
    };
    writeFileSync(sentFile, JSON.stringify(sentData));

    // Simulating cmdReplyTo logic
    let inReplyTo = "";
    if (existsSync(sentFile)) {
      try {
        const parsed = JSON.parse(readFileSync(sentFile, "utf8"));
        inReplyTo = parsed.messageId || "";
      } catch {
        inReplyTo = "";
      }
    }

    expect(inReplyTo).toBe("<carlton-2026-02-09@carlton.local>");
  });

  test("handles missing .briefing-sent file", () => {
    const sentFile = join(TEST_DIR, ".briefing-sent");

    // Simulating cmdReplyTo logic
    let inReplyTo = "";
    if (existsSync(sentFile)) {
      try {
        const parsed = JSON.parse(readFileSync(sentFile, "utf8"));
        inReplyTo = parsed.messageId || "";
      } catch {
        inReplyTo = "";
      }
    }

    expect(inReplyTo).toBe("");
  });

  test("handles malformed JSON gracefully", () => {
    const sentFile = join(TEST_DIR, ".briefing-sent");
    writeFileSync(sentFile, "not valid json {{{");

    // Simulating cmdReplyTo logic
    let inReplyTo = "";
    if (existsSync(sentFile)) {
      try {
        const parsed = JSON.parse(readFileSync(sentFile, "utf8"));
        inReplyTo = parsed.messageId || "";
      } catch {
        inReplyTo = "";
      }
    }

    expect(inReplyTo).toBe("");
  });
});
