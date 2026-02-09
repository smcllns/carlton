import { describe, expect, test, beforeEach, afterEach } from "bun:test";
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

## Accounts

- alice@gmail.com
- bob@gmail.com

## Delivery

- email: sam@example.com
- time: 05:00
- timezone: GMT

## Briefing Format

Show time, location, attendees.

## Research Instructions

Search Gmail and Drive for context.
`;

// Isolate tests from env vars that override PROMPT.md
const ENV_VARS = ["CARLTON_ACCOUNTS", "DELIVER_TO_EMAIL", "CARLTON_DELIVERY_EMAIL"];
let savedEnv: Record<string, string | undefined> = {};

describe("loadPrompt", () => {
  beforeEach(() => {
    for (const key of ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_VARS) {
      if (savedEnv[key] !== undefined) process.env[key] = savedEnv[key];
      else delete process.env[key];
    }
  });

  test("parses valid PROMPT.md", () => {
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
    expect(() => loadPrompt(filepath)).toThrow("No accounts configured");
  });

  test("throws if Delivery missing email", () => {
    const content = VALID_PROMPT.replace("- email: sam@example.com\n", "");
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

  test("throws on placeholder accounts", () => {
    const content = VALID_PROMPT.replace(
      "- alice@gmail.com\n- bob@gmail.com",
      "- myworkemail@gmail.com\n- mypersonalemail@gmail.com"
    );
    const filepath = writeTempPrompt(content);
    expect(() => loadPrompt(filepath)).toThrow("Placeholder account(s) detected");
  });

  test("throws on placeholder delivery email", () => {
    const content = VALID_PROMPT.replace("sam@example.com", "you@gmail.com");
    const filepath = writeTempPrompt(content);
    expect(() => loadPrompt(filepath)).toThrow("Placeholder delivery email detected");
  });

  test("CARLTON_ACCOUNTS env var overrides PROMPT.md", () => {
    process.env.CARLTON_ACCOUNTS = "real@gmail.com,other@gmail.com";
    const filepath = writeTempPrompt(VALID_PROMPT);
    const config = loadPrompt(filepath);
    expect(config.accounts).toEqual(["real@gmail.com", "other@gmail.com"]);
  });

  test("DELIVER_TO_EMAIL env var overrides PROMPT.md", () => {
    process.env.DELIVER_TO_EMAIL = "override@gmail.com";
    const filepath = writeTempPrompt(VALID_PROMPT);
    const config = loadPrompt(filepath);
    expect(config.delivery.email).toBe("override@gmail.com");
  });
});
