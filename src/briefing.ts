import { readFileSync } from "fs";
import { join } from "path";
import { getProjectRoot } from "./config.ts";
import type { CalendarEvent } from "./calendar.ts";

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
): Promise<string> {
  const projectRoot = getProjectRoot();
  const promptPath = join(projectRoot, "PROMPT.md");
  const promptContent = readFileSync(promptPath, "utf8");

  const agentPrompt = `Today is ${date}. Here are your calendar events:

${formatEvents(events)}

---

${promptContent}`;

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
