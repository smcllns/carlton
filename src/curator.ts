import { join } from "path";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { getProjectRoot, getReportsDir, getMemoryFile } from "./config.ts";
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

  sections.push(`# Carlton Curator — Briefing for ${date}`);
  sections.push("");
  sections.push(`You are Carlton, an executive assistant. Your job is to produce a polished meeting briefing email for ${date} and send it.`);
  sections.push("");

  // Briefing format from PROMPT.md
  sections.push("## Briefing Format");
  sections.push("");
  sections.push(prompt.briefingFormat);
  sections.push("");

  // Memory — accumulated user preferences
  const memoryFile = getMemoryFile();
  if (existsSync(memoryFile)) {
    const memory = readFileSync(memoryFile, "utf8");
    sections.push("## User Preferences (memory.txt)");
    sections.push("");
    sections.push(memory);
    sections.push("");
  }

  // Per-event sections: research or fallback
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
      const research = readFileSync(result.filepath, "utf8");
      sections.push("#### Research");
      sections.push("");
      sections.push(research);
    } else {
      sections.push("#### Research");
      sections.push("");
      if (result?.error) {
        sections.push(`_Research failed: ${result.error}_`);
      } else {
        sections.push("_No research available._");
      }
      sections.push("");
      sections.push("Fallback event data:");
      sections.push("");
      sections.push(formatBasicReport(event));
    }
    sections.push("");
  }

  // Instructions
  sections.push("## Your Task");
  sections.push("");
  sections.push(`1. Read all the research above and the user preferences from memory.txt`);
  sections.push(`2. Write a polished briefing to \`reports/${date}/briefing.md\``);
  sections.push(`   - Follow the Briefing Format spec above`);
  sections.push(`   - Apply any user preferences from memory.txt`);
  sections.push(`   - Combine all meetings into a single briefing document`);
  sections.push(`3. Send the briefing: \`bun carlton send-briefing ${date}\``);
  sections.push("");

  // Self-improvement proposals
  sections.push("## Self-Improvement (Optional)");
  sections.push("");
  sections.push("If you notice something in Carlton's code that could be improved:");
  sections.push("- Read the relevant source file in `src/`");
  sections.push("- Write a proposal to `src/<filename>.self.md` with this format:");
  sections.push("");
  sections.push("```markdown");
  sections.push("# Proposed: <filename>");
  sections.push("## Why");
  sections.push("<reason>");
  sections.push("## Current → Proposed");
  sections.push("<diff block>");
  sections.push("```");
  sections.push("");
  sections.push("You can read `src/**` but you must NOT edit `.ts` files directly.");
  sections.push("");

  return sections.join("\n");
}

export function spawnCurator(date: string, contextFile: string): void {
  const projectRoot = getProjectRoot();
  const windowName = `curator-${date}`;
  const contextRelative = contextFile.replace(projectRoot + "/", "");
  const claudeCmd = `claude "You are the Carlton curator. Read ${contextRelative} for your full context and instructions."`;

  console.log(`🤖 Spawning curator in tmux window '${windowName}'`);
  Bun.spawn(
    ["tmux", "new-window", "-n", windowName, "-c", projectRoot, claudeCmd],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
}
