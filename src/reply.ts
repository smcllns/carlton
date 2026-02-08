import { existsSync, readdirSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getReportsDir } from "./config.ts";

export function maxReplyNumber(responsesDir: string): number {
  if (!existsSync(responsesDir)) return 0;
  let max = 0;
  for (const f of readdirSync(responsesDir)) {
    const m = f.match(/^(\d+)-reply\.md$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

export function maxResponseNumber(responsesDir: string): number {
  if (!existsSync(responsesDir)) return 0;
  let max = 0;
  for (const f of readdirSync(responsesDir)) {
    const m = f.match(/^(\d+)-response\.md$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

export function hasUnprocessedReplies(responsesDir: string): boolean {
  return maxReplyNumber(responsesDir) > maxResponseNumber(responsesDir);
}

export function nextReplyNumber(responsesDir: string): number {
  return maxReplyNumber(responsesDir) + 1;
}

export function replyFilePaths(responsesDir: string, num: number): { replyFile: string; responseFile: string } {
  const prefix = String(num).padStart(2, "0");
  return {
    replyFile: join(responsesDir, `${prefix}-reply.md`),
    responseFile: join(responsesDir, `${prefix}-response.md`),
  };
}

export function writeReplyFile(replyFile: string, num: number, from: string, date: string, subject: string, body: string): void {
  writeFileSync(replyFile, `# User Reply #${num}

**From:** ${from}
**Date:** ${date}
**Subject:** ${subject}

${body}
`, "utf8");
}

export function appendToThread(threadFile: string, section: string, content: string): void {
  const entry = `\n---\n\n## ${section}\n\n${content}\n`;
  mkdirSync(dirname(threadFile), { recursive: true });
  if (!existsSync(threadFile)) {
    writeFileSync(threadFile, entry, "utf8");
  } else {
    appendFileSync(threadFile, entry, "utf8");
  }
}

export function removeNewMarkers(threadFile: string): void {
  if (!existsSync(threadFile)) return;
  const content = readFileSync(threadFile, "utf8");
  const updated = content.replace(/^## NEW (Reply #\d+)/gm, "## $1");
  if (updated !== content) {
    writeFileSync(threadFile, updated, "utf8");
  }
}

export function buildReplyPrompt(date: string): string {
  const reportsDir = getReportsDir();
  const dateDir = join(reportsDir, date);
  const threadFile = join(dateDir, "thread.md");

  if (!existsSync(threadFile)) {
    throw new Error(`No thread.md found at ${threadFile}. Cannot build reply prompt.`);
  }

  const threadContent = readFileSync(threadFile, "utf8");

  const responsesDir = join(dateDir, "responses");
  const highestReply = maxReplyNumber(responsesDir);
  const responseNum = String(highestReply).padStart(2, "0");

  // List research files if they exist
  const researchDir = join(dateDir, "research");
  let researchListing = "";
  if (existsSync(researchDir)) {
    const files = readdirSync(researchDir).filter(f => f.endsWith(".md")).sort();
    if (files.length > 0) {
      researchListing = files.map(f => `- reports/${date}/research/${f}`).join("\n");
    }
  }

  const subject = `Re: ${date} Carlton Briefing Notes`;

  return `You are Carlton's reply handler for the ${date} briefing.

## Thread

${threadContent}

## Available Context

If you need deeper context:
${researchListing ? researchListing : `- reports/${date}/research/ — (no research files found)`}
- reports/memory.txt — user preferences
- Google tools: bunx gmcli, bunx gccli, bunx gdcli (read-only, use --help)

Read what you need. You may not need any of it.

## Respond

Respond to all replies marked NEW above.
1. Write response: reports/${date}/responses/${responseNum}-response.md
   (NN = highest reply# being addressed)
2. Send: bun carlton reply-to "${subject}" reports/${date}/responses/${responseNum}-response.md ${date}
3. Update reports/memory.txt with user preferences if any
   - Use format: [YYYY-MM-DD] preference: one-line learning
   - Do NOT log process observations — only things that should change future briefing output
4. rm reports/${date}/responses/.processing
`;
}
