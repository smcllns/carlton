import { getProjectRoot } from "./config.ts";
import type { CalendarEvent } from "./calendar.ts";
import type { PromptConfig } from "./prompt.ts";

function formatEvents(events: CalendarEvent[]): string {
  return events.map((e, i) => {
    const num = String(i + 1).padStart(2, "0");
    const parts = [
      `${num}. **${e.summary}**`,
      `    Time: ${e.start} — ${e.end}`,
    ];
    if (e.location) parts.push(`    Location: ${e.location}`);
    if (e.description) parts.push(`    Description: ${e.description}`);
    if (e.attendees.length > 0) parts.push(`    Attendees: ${e.attendees.join(", ")}`);
    return parts.join("\n");
  }).join("\n\n");
}

export async function runBriefingAgent(
  date: string,
  events: CalendarEvent[],
  prompt: PromptConfig,
): Promise<string> {
  const projectRoot = getProjectRoot();
  const accountList = prompt.accounts.map((a) => `- ${a}`).join("\n");
  const systemLine = prompt.system ? `${prompt.system}\n\n` : "";

  const agentPrompt = `${systemLine}You are preparing a daily meeting briefing for ${date}.

## Calendar Events

${formatEvents(events)}

## Accounts Available for Research

${accountList}

## CLI Tools

- \`bunx gmcli <account> search "<query>"\` — search Gmail
- \`bunx gmcli <account> thread <thread_id>\` — read a thread
- \`bunx gccli <account> events --query "<query>" --from <date> --to <date>\` — search calendar
- \`bunx gdcli <account> search "<query>"\` — search Google Drive
- \`bunx gdcli <account> download <file_id>\` — download a file
- All tools support \`--help\` for full usage.

## Research Instructions

${prompt.researchInstructions}

## Briefing Format

${prompt.briefingFormat}

## Your Task

Research these meetings using the tools above, then produce the final briefing.

For each meeting, decide how much research is warranted:
- High-stakes meetings with external attendees → deep dive (email history, docs, attendee context)
- Recurring internal syncs → light touch
- Personal/automated calendar entries → minimal or skip

Output ONLY the final briefing markdown — start directly with the heading. No preamble, thinking, or explanation before or after the briefing.`;

  const allowedTools = [
    "Bash(bunx gmcli:*)",
    "Bash(bunx gccli:*)",
    "Bash(bunx gdcli:*)",
    "Task",
  ].join(",");

  console.log("Running briefing agent...\n");

  const proc = Bun.spawn(
    ["claude", "-p", agentPrompt, "--model", "sonnet", "--allowedTools", allowedTools],
    {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    },
  );

  const timeout = setTimeout(() => proc.kill(), 300_000);
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  clearTimeout(timeout);

  if (exitCode !== 0) {
    throw new Error(`Briefing agent failed (exit ${exitCode}): ${stderr.slice(0, 300)}`);
  }

  const briefing = stdout.trim();
  if (briefing.length === 0) {
    throw new Error("Briefing agent produced empty output");
  }

  return briefing;
}
