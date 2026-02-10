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
  subjectPattern: string;
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

  const accountsSection = sections["Calendars to Include"] || sections["Accounts"];
  if (!accountsSection) {
    throw new Error("PROMPT.md missing required section: ## Calendars to Include");
  }

  const deliverySection = sections["Daily Delivery"] || sections["Delivery"] || sections["Daily Briefing Delivery"];
  if (!deliverySection) {
    throw new Error("PROMPT.md missing required section: ## Daily Delivery");
  }

  const briefingSection = sections["Briefing Format"] || sections["Briefing Email Format"];
  if (!briefingSection) {
    throw new Error("PROMPT.md missing required section: ## Briefing Format");
  }

  const accounts = parseAccountsList(accountsSection);
  if (accounts.length === 0) {
    throw new Error("No accounts configured in PROMPT.md ## Calendars to Include");
  }

  const delivery = parseDeliveryConfig(deliverySection);

  const { subjectPattern, body: briefingBody } = parseSubjectLine(briefingSection);

  return {
    system: sections["System"] || "",
    accounts,
    delivery,
    subjectPattern,
    briefingFormat: briefingBody.trim(),
    researchInstructions: (sections["Research Instructions"] || "").trim(),
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

function parseSubjectLine(section: string): { subjectPattern: string; body: string } {
  const lines = section.split("\n");
  const subjectIdx = lines.findIndex((l) =>
    /subject\s*line/i.test(l)
  );
  if (subjectIdx === -1) return { subjectPattern: "", body: section };

  const match = lines[subjectIdx].match(/:\s*(.+)/);
  const pattern = match ? match[1].trim() : "";
  const body = lines.filter((_, i) => i !== subjectIdx).join("\n");
  return { subjectPattern: pattern, body };
}

function parseDeliveryConfig(section: string): DeliveryConfig {
  const lines = section.split("\n");
  let email = "";
  let time = "";
  let timezone = "";

  for (const line of lines) {
    const stripped = line.replace(/^[-*]\s*/, "").trim();

    const emailMatch = stripped.match(/^(?:send to|email):\s*(.+)/i);
    if (emailMatch) email = emailMatch[1].trim();

    const whenMatch = stripped.match(/^(?:when|time):\s*(\S+)(?:\s*\(timezone:\s*(.+?)\))?/i);
    if (whenMatch) {
      time = whenMatch[1].trim();
      if (whenMatch[2]) timezone = whenMatch[2].trim();
    }

    const tzMatch = stripped.match(/^timezone:\s*(.+)/i);
    if (tzMatch) timezone = tzMatch[1].trim();
  }

  if (!email) throw new Error("PROMPT.md ## Daily Delivery missing 'send to'");
  if (!time) throw new Error("PROMPT.md ## Daily Delivery missing 'when'");
  if (!timezone) throw new Error("PROMPT.md ## Daily Delivery missing timezone");

  return { email, time, timezone };
}
