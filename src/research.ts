import { join } from "path";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { getProjectRoot, getReportsDir } from "./config.ts";
import type { CalendarEvent } from "./calendar.ts";
import type { PromptConfig } from "./prompt.ts";

function eventTimeSlug(event: CalendarEvent): string {
  const timeMatch = event.start.match(/T(\d{2}):(\d{2})/);
  const hhmm = timeMatch ? `${timeMatch[1]}${timeMatch[2]}` : "0000";
  const slug = event.summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${hhmm}-${slug}`;
}

export interface ResearchResult {
  event: CalendarEvent;
  filepath: string;
  success: boolean;
  error?: string;
}

export function buildResearchPrompt(
  event: CalendarEvent,
  accounts: string[],
  researchInstructions: string,
  system?: string,
): string {
  const accountList = accounts.map((a) => `- ${a}`).join("\n");
  const attendeeList = event.attendees.length > 0
    ? event.attendees.map((a) => `- ${a}`).join("\n")
    : "- (no attendees listed)";

  const systemLine = system ? `${system}\n\n` : "";
  return `${systemLine}You are a research assistant preparing context for a meeting.

## Meeting
- **Title:** ${event.summary}
- **Time:** ${event.start} — ${event.end}
- **Location:** ${event.location || "not specified"}
- **Description:** ${event.description || "none"}

## Attendees
${attendeeList}

## Accounts to search
${accountList}

## CLI Tools
- \`bunx gmcli <account> search "<query>"\` — search Gmail
- \`bunx gmcli <account> thread <thread_id>\` — read a thread
- \`bunx gccli <account> events --query "<query>" --from <date> --to <date>\` — search calendar
- \`bunx gdcli <account> search "<query>"\` — search Google Drive
- \`bunx gdcli <account> download <file_id>\` — download a file
- All tools support \`--help\` for full usage.

## Research Instructions
${researchInstructions}

## Output
Write a markdown summary with:
1. **Meeting context** — why is this happening, what's the history
2. **Attendee info** — who are they, past interactions, relevant threads
3. **Relevant documents** — any shared docs, slides, or notes
4. **Key email threads** — recent conversations about this topic
5. **Preparation needed** — what should the user review or bring

Be thorough but concise. Include links and references where available.`;
}

export async function runResearch(
  date: string,
  events: CalendarEvent[],
  prompt: PromptConfig,
): Promise<ResearchResult[]> {
  const researchDir = join(getReportsDir(), date, "research");
  mkdirSync(researchDir, { recursive: true });

  const projectRoot = getProjectRoot();
  const allowedTools = [
    "Bash(bunx gmcli:*)",
    "Bash(bunx gccli:*)",
    "Bash(bunx gdcli:*)",
    "Read(reports/**)",
    "Write(reports/**)",
  ].join(",");

  const promises = events.map(async (event, i): Promise<ResearchResult> => {
    const num = String(i + 1).padStart(2, "0");
    const filepath = join(researchDir, `${num}-RES-${eventTimeSlug(event)}.md`);

    // Skip if this research slot already has a file (handles old naming too)
    const existing = readdirSync(researchDir).find((f) => f.startsWith(`${num}-`) && f.endsWith(".md"));
    if (existing) {
      const existingPath = join(researchDir, existing);
      if (readFileSync(existingPath, "utf8").trim().length > 0) {
        console.log(`  ♻️  Skipping research for "${event.summary}" (already done)`);
        return { event, filepath: existingPath, success: true };
      }
    }

    const researchPrompt = buildResearchPrompt(
      event,
      prompt.accounts,
      prompt.researchInstructions,
      prompt.system,
    );

    try {
      const proc = Bun.spawn(
        [
          "claude",
          "-p", researchPrompt,
          "--model", "haiku",
          "--allowedTools", allowedTools,
        ],
        {
          cwd: projectRoot,
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        },
      );

      const timeout = setTimeout(() => proc.kill(), 90_000);
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      clearTimeout(timeout);

      if (exitCode !== 0) {
        return { event, filepath, success: false, error: `exit ${exitCode}: ${stderr.slice(0, 200)}` };
      }

      writeFileSync(filepath, stdout, "utf8");

      return { event, filepath, success: true };
    } catch (err: any) {
      return { event, filepath, success: false, error: err.message };
    }
  });

  return Promise.all(promises);
}
