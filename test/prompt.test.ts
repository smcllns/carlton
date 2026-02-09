import { describe, expect, test } from "bun:test";
import { loadPrompt } from "../src/prompt.ts";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function writeTempPrompt(content: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "carlton-test-"));
  const filepath = path.join(tmpDir, "PROMPT.md");
  fs.writeFileSync(filepath, content);
  return filepath;
}

const VALID_PROMPT = `# Carlton Configuration

## System

You are Carlton.

## Calendars to Include

- alice@gmail.com
- bob@gmail.com

## Daily Delivery

- send to: sam@example.com
- when: 05:00 (timezone: GMT)

## Briefing Format

Show time, location, attendees.

## Research Instructions

Search Gmail and Drive for context.
`;

describe("loadPrompt", () => {
  test("parses valid PROMPT.md with new format", () => {
    const filepath = writeTempPrompt(VALID_PROMPT);
    const config = loadPrompt(filepath);

    expect(config.accounts).toEqual(["alice@gmail.com", "bob@gmail.com"]);
    expect(config.delivery.email).toBe("sam@example.com");
    expect(config.delivery.time).toBe("05:00");
    expect(config.delivery.timezone).toBe("GMT");
    expect(config.briefingFormat).toContain("time, location, attendees");
    expect(config.researchInstructions).toContain("Search Gmail");
    expect(config.system).toContain("You are Carlton");
  });

  test("parses old-style delivery format", () => {
    const content = VALID_PROMPT.replace(
      "## Daily Delivery\n\n- send to: sam@example.com\n- when: 05:00 (timezone: GMT)",
      "## Delivery\n\n- email: sam@example.com\n- time: 05:00\n- timezone: GMT"
    );
    const filepath = writeTempPrompt(content);
    const config = loadPrompt(filepath);

    expect(config.delivery.email).toBe("sam@example.com");
    expect(config.delivery.time).toBe("05:00");
    expect(config.delivery.timezone).toBe("GMT");
  });

  test("parses old-style Accounts section name", () => {
    const content = VALID_PROMPT.replace("## Calendars to Include", "## Accounts");
    const filepath = writeTempPrompt(content);
    const config = loadPrompt(filepath);
    expect(config.accounts).toEqual(["alice@gmail.com", "bob@gmail.com"]);
  });

  test("throws if file missing", () => {
    expect(() => loadPrompt("/nonexistent/PROMPT.md")).toThrow("not found");
  });

  test("throws if Calendars section missing", () => {
    const content = VALID_PROMPT.replace(/## Calendars to Include[\s\S]*?(?=## Daily Delivery)/, "");
    const filepath = writeTempPrompt(content);
    expect(() => loadPrompt(filepath)).toThrow("missing required section");
  });

  test("throws if Delivery section missing", () => {
    const content = VALID_PROMPT.replace(/## Daily Delivery[\s\S]*?(?=## Briefing Format)/, "");
    const filepath = writeTempPrompt(content);
    expect(() => loadPrompt(filepath)).toThrow("missing required section");
  });

  test("throws if Calendars section has no emails", () => {
    const content = VALID_PROMPT.replace(
      "- alice@gmail.com\n- bob@gmail.com",
      "- not an email\n- also not"
    );
    const filepath = writeTempPrompt(content);
    expect(() => loadPrompt(filepath)).toThrow("No accounts configured");
  });

  test("throws if Delivery missing send to", () => {
    const content = VALID_PROMPT.replace("- send to: sam@example.com\n", "");
    const filepath = writeTempPrompt(content);
    expect(() => loadPrompt(filepath)).toThrow("missing 'send to'");
  });

  test("throws if Delivery missing when", () => {
    const content = VALID_PROMPT.replace("- when: 05:00 (timezone: GMT)\n", "");
    const filepath = writeTempPrompt(content);
    expect(() => loadPrompt(filepath)).toThrow("missing 'when'");
  });
});
