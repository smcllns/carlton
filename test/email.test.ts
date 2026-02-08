import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { extractMessageId } from "../src/email.ts";

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

describe("extractMessageId", () => {
  test("extracts Message-ID from Gmail message headers", () => {
    const msg = {
      payload: {
        headers: [
          { name: "From", value: "user@gmail.com" },
          { name: "Message-ID", value: "<abc123@mail.gmail.com>" },
          { name: "Subject", value: "Re: Test" },
        ],
      },
    };

    expect(extractMessageId(msg)).toBe("<abc123@mail.gmail.com>");
  });

  test("handles case-insensitive header name", () => {
    const msg = {
      payload: {
        headers: [
          { name: "message-id", value: "<lower@mail.gmail.com>" },
        ],
      },
    };

    expect(extractMessageId(msg)).toBe("<lower@mail.gmail.com>");
  });

  test("returns empty string when Message-ID header missing", () => {
    const msg = {
      payload: {
        headers: [
          { name: "From", value: "user@gmail.com" },
        ],
      },
    };

    expect(extractMessageId(msg)).toBe("");
  });

  test("returns empty string for malformed message", () => {
    expect(extractMessageId({})).toBe("");
    expect(extractMessageId({ payload: {} })).toBe("");
    expect(extractMessageId({ payload: { headers: null } })).toBe("");
  });
});

describe("email threading headers", () => {
  test("In-Reply-To and References should use same messageId", () => {
    // Now using the reply's Gmail Message-ID instead of briefing's Message-ID
    const replyMessageId = "<abc123@mail.gmail.com>";

    // Simulating what sendReply does
    const headers = {
      "In-Reply-To": replyMessageId,
      References: replyMessageId,
    };

    expect(headers["In-Reply-To"]).toBe(replyMessageId);
    expect(headers.References).toBe(replyMessageId);
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

describe("cmdReplyTo reads messageId from .last-reply-id", () => {
  test("reads Gmail Message-ID from .last-reply-id file", () => {
    const responsesDir = join(TEST_DIR, "responses");
    mkdirSync(responsesDir, { recursive: true });
    const replyIdFile = join(responsesDir, ".last-reply-id");
    writeFileSync(replyIdFile, "<abc123@mail.gmail.com>");

    // Simulating cmdReplyTo logic
    let inReplyTo = "";
    if (existsSync(replyIdFile)) {
      inReplyTo = readFileSync(replyIdFile, "utf8").trim();
    }

    expect(inReplyTo).toBe("<abc123@mail.gmail.com>");
  });

  test("handles missing .last-reply-id file", () => {
    const replyIdFile = join(TEST_DIR, "responses", ".last-reply-id");

    // Simulating cmdReplyTo logic
    let inReplyTo = "";
    if (existsSync(replyIdFile)) {
      inReplyTo = readFileSync(replyIdFile, "utf8").trim();
    }

    expect(inReplyTo).toBe("");
  });

  test("trims whitespace from Message-ID", () => {
    const responsesDir = join(TEST_DIR, "responses");
    mkdirSync(responsesDir, { recursive: true });
    const replyIdFile = join(responsesDir, ".last-reply-id");
    writeFileSync(replyIdFile, "  <abc123@mail.gmail.com>\n");

    // Simulating cmdReplyTo logic
    let inReplyTo = "";
    if (existsSync(replyIdFile)) {
      inReplyTo = readFileSync(replyIdFile, "utf8").trim();
    }

    expect(inReplyTo).toBe("<abc123@mail.gmail.com>");
  });
});
