import { join } from "path";
import { readFileSync, existsSync } from "fs";
import { getProjectRoot, getMemoryFile } from "./config.ts";
import { formatBasicReport } from "./report.ts";
import type { CalendarEvent } from "./calendar.ts";
import type { PromptConfig } from "./prompt.ts";
import type { ResearchResult } from "./research.ts";

export function buildCuratorContext(
  date: string,
  events: CalendarEvent[],
  researchResults: ResearchResult[],
  prompt: PromptConfig,
): string {
  const sections: string[] = [];

  sections.push(`# Briefing for ${date}`);
  sections.push("");

  sections.push("## Briefing Format");
  sections.push("");
  sections.push(prompt.briefingFormat);
  sections.push("");

  const memoryFile = getMemoryFile();
  if (existsSync(memoryFile)) {
    const memory = readFileSync(memoryFile, "utf8");
    sections.push("## User Preferences (memory.txt)");
    sections.push("");
    sections.push(memory);
    sections.push("");
  }

  sections.push(`## Meetings (${events.length})`);
  sections.push("");

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const result = researchResults[i];
    const num = String(i + 1).padStart(2, "0");

    sections.push(`### ${num}. ${event.summary}`);
    sections.push(`**Time:** ${event.start} — ${event.end}`);
    if (event.location) sections.push(`**Location:** ${event.location}`);
    if (event.attendees.length > 0) {
      sections.push(`**Attendees:** ${event.attendees.join(", ")}`);
    }
    sections.push("");

    if (result?.success && existsSync(result.filepath)) {
      sections.push(readFileSync(result.filepath, "utf8"));
    } else if (result?.error) {
      sections.push(`_Research failed: ${result.error}_`);
      sections.push("");
      sections.push(formatBasicReport(event));
    } else {
      sections.push(formatBasicReport(event));
    }
    sections.push("");
  }

  sections.push("## Task");
  sections.push("");
  sections.push(`1. Write the briefing to \`reports/${date}/briefing.md\``);
  sections.push(`2. Send it: \`bun carlton send-briefing ${date}\``);
  sections.push("");

  return sections.join("\n");
}

export async function runCurator(date: string, contextFile: string): Promise<number> {
  const projectRoot = getProjectRoot();
  const contextRelative = contextFile.replace(projectRoot + "/", "");
  const allowedTools = "Read(reports/**),Write(reports/**),Bash(bun carlton send-briefing *)";
  const prompt = `Read ${contextRelative} and follow the task instructions at the end. All research is already done — do not search for more. Check reports/memory.txt for user preferences.`;

  console.log(`🤖 Running curator...`);
  const proc = Bun.spawn(
    ["claude", "-p", "--model", "sonnet", "--allowedTools", allowedTools],
    { cwd: projectRoot, stdio: ["pipe", "ignore", "ignore"] },
  );
  proc.stdin.write(prompt);
  proc.stdin.end();
  return proc.exited;
}
