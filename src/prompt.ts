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

  const accounts = parseAccountsList(sections["Accounts"]);
  if (accounts.length === 0) {
    throw new Error("PROMPT.md ## Accounts section has no email addresses");
  }

  const delivery = parseDeliveryConfig(deliverySection);

  return {
    system: sections["System"] || "",
    accounts,
    delivery,
    briefingFormat: sections["Briefing Format"].trim(),
    researchInstructions: sections["Research Instructions"].trim(),
  };
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
