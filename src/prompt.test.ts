import { describe, expect, test } from "bun:test";
import { loadPrompt } from "./prompt.ts";
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

## Accounts

- alice@gmail.com
- bob@gmail.com

## Delivery

- email: user@example.com
- time: 05:00
- timezone: GMT

## Briefing Format

Show time, location, attendees.

## Research Instructions

Search Gmail and Drive for context.
`;

describe("loadPrompt", () => {
  test("parses valid PROMPT.md", () => {
    const filepath = writeTempPrompt(VALID_PROMPT);
    const config = loadPrompt(filepath);

    expect(config.accounts).toEqual(["alice@gmail.com", "bob@gmail.com"]);
    expect(config.delivery.email).toBe("user@example.com");
    expect(config.delivery.time).toBe("05:00");
    expect(config.delivery.timezone).toBe("GMT");
    expect(config.briefingFormat).toContain("time, location, attendees");
    expect(config.researchInstructions).toContain("Search Gmail");
    expect(config.system).toContain("You are Carlton");
  });

  test("throws if file missing", () => {
    expect(() => loadPrompt("/nonexistent/PROMPT.md")).toThrow("not found");
  });

  test("throws if Accounts section missing", () => {
    const content = VALID_PROMPT.replace(/## Accounts[\s\S]*?(?=## Delivery)/, "");
    const filepath = writeTempPrompt(content);
    expect(() => loadPrompt(filepath)).toThrow("missing required section: ## Accounts");
  });

  test("throws if Delivery section missing", () => {
    const content = VALID_PROMPT.replace(/## Delivery[\s\S]*?(?=## Briefing Format)/, "");
    const filepath = writeTempPrompt(content);
    expect(() => loadPrompt(filepath)).toThrow("missing required section: ## Daily Briefing Delivery");
  });

  test("throws if Accounts section has no emails", () => {
    const content = VALID_PROMPT.replace(
      /## Accounts\n\n- alice@gmail\.com\n- bob@gmail\.com/,
      "## Accounts\n\n- not an email\n- also not"
    );
    const filepath = writeTempPrompt(content);
    expect(() => loadPrompt(filepath)).toThrow("no email addresses");
  });

  test("throws if Delivery missing email", () => {
    const content = VALID_PROMPT.replace("- email: user@example.com\n", "");
    const filepath = writeTempPrompt(content);
    expect(() => loadPrompt(filepath)).toThrow("missing 'email'");
  });

  test("throws if Delivery missing time", () => {
    const content = VALID_PROMPT.replace("- time: 05:00\n", "");
    const filepath = writeTempPrompt(content);
    expect(() => loadPrompt(filepath)).toThrow("missing 'time'");
  });

  test("throws if Delivery missing timezone", () => {
    const content = VALID_PROMPT.replace("- timezone: GMT\n", "");
    const filepath = writeTempPrompt(content);
    expect(() => loadPrompt(filepath)).toThrow("missing 'timezone'");
  });
});
