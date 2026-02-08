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

  sections.push(`# Carlton Curator — Briefing for ${date}`);
  sections.push("");
  sections.push(`⚠️ YOU ARE A BACKGROUND WORKER. You run via \`claude -p\` in a headless process.`);
  sections.push(`Your job is deterministic: read this file, write the briefing, send it. That's it.`);
  sections.push(`All research has already been done — the results are below. Do NOT search for`);
  sections.push(`additional information via Gmail, Calendar, Drive, or any other tool.`);
  sections.push(`The only extra file you may read is reports/memory.txt for user preferences.`);
  sections.push("");
  sections.push(`Your job: produce a polished meeting briefing email for ${date} and send it.`);
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

export async function runCurator(date: string, contextFile: string): Promise<number> {
  const projectRoot = getProjectRoot();
  const contextRelative = contextFile.replace(projectRoot + "/", "");
  const allowedTools = "Read(reports/**),Write(reports/**),Bash(bun carlton send-briefing *)";
  const prompt = `Read ${contextRelative} — it contains all research, meeting data, and your instructions. You have all the information you need. Do not search for additional information. If you want more context on user preferences, check reports/memory.txt. Follow the task instructions at the end of that file.`;

  console.log(`🤖 Running curator...`);
  const proc = Bun.spawn(
    ["claude", "-p", "--model", "haiku", "--allowedTools", allowedTools],
    { cwd: projectRoot, stdio: ["pipe", "ignore", "ignore"] },
  );
  proc.stdin.write(prompt);
  proc.stdin.end();
  return proc.exited;
}
