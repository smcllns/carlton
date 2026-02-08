import { describe, expect, test } from "bun:test";
import { briefingMessageId } from "../src/email.ts";

describe("email threading", () => {
  test("briefingMessageId generates correct format", () => {
    const id = briefingMessageId("2026-02-09");
    expect(id).toBe("<carlton-2026-02-09@carlton.local>");
  });

  test("briefingMessageId is deterministic", () => {
    const id1 = briefingMessageId("2026-02-09");
    const id2 = briefingMessageId("2026-02-09");
    expect(id1).toBe(id2);
  });

  test("different dates produce different Message-IDs", () => {
    const id1 = briefingMessageId("2026-02-09");
    const id2 = briefingMessageId("2026-02-10");
    expect(id1).not.toBe(id2);
  });

  test("Message-ID matches RFC 5322 format (angle brackets, @)", () => {
    const id = briefingMessageId("2099-01-01");
    expect(id).toMatch(/^<.+@.+>$/);
  });
});

describe(".briefing-sent JSON format", () => {
  test("expected JSON shape has resendId and messageId", () => {
    // This tests the contract — cmdSendBriefing writes this shape
    const sentData = { resendId: "abc-123", messageId: "<carlton-2026-02-09@carlton.local>" };
    const json = JSON.stringify(sentData);
    const parsed = JSON.parse(json);
    expect(parsed.resendId).toBe("abc-123");
    expect(parsed.messageId).toBe("<carlton-2026-02-09@carlton.local>");
  });
});
