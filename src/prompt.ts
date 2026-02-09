import * as fs from "fs";
import * as path from "path";
import { getProjectRoot } from "./config.ts";

export interface DeliveryConfig {
  email: string;
  time: string;
  timezone: string;
}

export interface PromptConfig {
  system: string;
  accounts: string[];
  delivery: DeliveryConfig;
  briefingFormat: string;
  researchInstructions: string;
}

const PROMPT_PATH = path.join(getProjectRoot(), "PROMPT.md");

export function loadPrompt(filepath = PROMPT_PATH): PromptConfig {
  if (!fs.existsSync(filepath)) {
    throw new Error(`PROMPT.md not found at ${filepath}`);
  }

  const raw = fs.readFileSync(filepath, "utf8");
  const sections = parseSections(raw);

  const required = ["Accounts", "Briefing Format", "Research Instructions"];
  for (const name of required) {
    if (!sections[name]) {
      throw new Error(`PROMPT.md missing required section: ## ${name}`);
    }
  }

  const deliverySection = sections["Daily Briefing Delivery"] || sections["Delivery"];
  if (!deliverySection) {
    throw new Error("PROMPT.md missing required section: ## Daily Briefing Delivery");
  }

  // Env vars override PROMPT.md
  const accounts = process.env.CARLTON_ACCOUNTS
    ? process.env.CARLTON_ACCOUNTS.split(",").map((a) => a.trim()).filter(Boolean)
    : parseAccountsList(sections["Accounts"]);
  if (accounts.length === 0) {
    throw new Error("No accounts configured. Set CARLTON_ACCOUNTS in .env or list them in PROMPT.md ## Accounts");
  }

  const delivery = parseDeliveryConfig(deliverySection);
  const deliveryOverride = process.env.DELIVER_TO_EMAIL || process.env.CARLTON_DELIVERY_EMAIL;
  if (deliveryOverride) {
    delivery.email = deliveryOverride;
  }

  validateNotPlaceholder(accounts, delivery.email);

  return {
    system: sections["System"] || "",
    accounts,
    delivery,
    briefingFormat: sections["Briefing Format"].trim(),
    researchInstructions: sections["Research Instructions"].trim(),
  };
}

const PLACEHOLDER_PATTERNS = [
  /^my\w+@/i,
  /^you@/i,
  /^your\w*@/i,
  /^user@/i,
  /^example@/i,
  /^test@/i,
];

function isPlaceholder(email: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(email));
}

function validateNotPlaceholder(accounts: string[], deliveryEmail: string) {
  const bad = accounts.filter(isPlaceholder);
  if (bad.length > 0) {
    throw new Error(
      `Placeholder account(s) detected: ${bad.join(", ")}. ` +
      `Set real emails via CARLTON_ACCOUNTS=a@gmail.com,b@gmail.com in .env or update PROMPT.md`
    );
  }
  if (isPlaceholder(deliveryEmail)) {
    throw new Error(
      `Placeholder delivery email detected: ${deliveryEmail}. ` +
      `Set a real email via DELIVER_TO_EMAIL in .env or update PROMPT.md`
    );
  }
}

function parseSections(raw: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = raw.split("\n");
  let currentSection: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const match = line.match(/^## (.+)$/);
    if (match) {
      if (currentSection) {
        sections[currentSection] = currentContent.join("\n");
      }
      currentSection = match[1].trim();
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }

  if (currentSection) {
    sections[currentSection] = currentContent.join("\n");
  }

  return sections;
}

function parseAccountsList(section: string): string[] {
  return section
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.includes("@"));
}

function parseDeliveryConfig(section: string): DeliveryConfig {
  const kvs: Record<string, string> = {};
  for (const line of section.split("\n")) {
    const match = line.match(/^[-*]\s*(\w+):\s*(.+)$/);
    if (match) {
      kvs[match[1].toLowerCase()] = match[2].trim();
    }
  }

  if (!kvs.email) throw new Error("PROMPT.md ## Delivery missing 'email'");
  if (!kvs.time) throw new Error("PROMPT.md ## Delivery missing 'time'");
  if (!kvs.timezone) throw new Error("PROMPT.md ## Delivery missing 'timezone'");

  return {
    email: kvs.email,
    time: kvs.time,
    timezone: kvs.timezone,
  };
}
