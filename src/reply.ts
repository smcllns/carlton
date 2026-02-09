import { existsSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { getReportsDir } from "./config.ts";

/**
 * Get the highest reply number in a directory.
 * Returns 0 if no reply files exist.
 */
export function maxReplyNumber(dir: string): number {
  if (!existsSync(dir)) return 0;
  const files = readdirSync(dir).filter((f) => f.match(/^\d+-reply\.md$/));
  if (files.length === 0) return 0;
  return Math.max(...files.map((f) => parseInt(f.match(/^(\d+)/)?.[1] || "0", 10)));
}

/**
 * Get the highest response number in a directory.
 * Returns 0 if no response files exist.
 */
export function maxResponseNumber(dir: string): number {
  if (!existsSync(dir)) return 0;
  const files = readdirSync(dir).filter((f) => f.match(/^\d+-response\.md$/));
  if (files.length === 0) return 0;
  return Math.max(...files.map((f) => parseInt(f.match(/^(\d+)/)?.[1] || "0", 10)));
}

/**
 * Check if there are unprocessed replies (replies without responses).
 */
export function hasUnprocessedReplies(dir: string): boolean {
  if (!existsSync(dir)) return false;
  const maxReply = maxReplyNumber(dir);
  const maxResponse = maxResponseNumber(dir);
  return maxReply > maxResponse;
}

/**
 * Next reply number — uses max existing number + 1 to handle gaps.
 */
export function nextReplyNumber(responsesDir: string): number {
  return maxReplyNumber(responsesDir) + 1;
}

/**
 * Write a reply file with metadata and body.
 */
export function writeReplyFile(
  replyFile: string,
  num: number,
  from: string,
  date: string,
  subject: string,
  body: string
): void {
  writeFileSync(
    replyFile,
    `# User Reply #${num}

**From:** ${from}
**Date:** ${date}
**Subject:** ${subject}

${body}
`,
    "utf8"
  );
}

/**
 * Get file paths for a reply/response exchange.
 */
export function replyFilePaths(
  responsesDir: string,
  num: number
): { replyFile: string; responseFile: string; contextFile: string } {
  const prefix = String(num).padStart(2, "0");
  return {
    replyFile: join(responsesDir, `${prefix}-reply.md`),
    responseFile: join(responsesDir, `${prefix}-response.md`),
    contextFile: join(responsesDir, `${prefix}-context.md`),
  };
}

/**
 * Append a section to thread.md.
 */
export function appendToThread(threadFile: string, sectionHeader: string, content: string): void {
  const section = `
## ${sectionHeader}

${content}

---
`;
  if (existsSync(threadFile)) {
    appendFileSync(threadFile, section, "utf8");
  } else {
    writeFileSync(threadFile, section, "utf8");
  }
}

/**
 * Build the prompt for the reply Claude agent.
 * Reads thread.md and inlines it into the prompt template.
 */
export function buildReplyPrompt(date: string): string {
  const reportsDir = getReportsDir();
  const dateDir = join(reportsDir, date);
  const threadFile = join(dateDir, "thread.md");
  const researchDir = join(dateDir, "research");

  if (!existsSync(threadFile)) {
    throw new Error(`thread.md not found for ${date}. Was the briefing sent?`);
  }

  const threadContent = readFileSync(threadFile, "utf8");

  // List research files if they exist
  let researchFiles: string[] = [];
  if (existsSync(researchDir)) {
    researchFiles = readdirSync(researchDir).filter((f) => f.endsWith(".md"));
  }

  const researchList =
    researchFiles.length > 0
      ? researchFiles.map((f) => `- reports/${date}/research/${f}`).join("\n")
      : "- (no research files available)";

  const responsesDir = join(dateDir, "responses");
  const maxReply = maxReplyNumber(responsesDir);
  const responseNum = String(maxReply).padStart(2, "0");

  return `You are Carlton's reply handler for the ${date} briefing.

## Thread

${threadContent}

## Available Context

If you need deeper context:
${researchList}
- Google tools: bunx gmcli, bunx gccli, bunx gdcli (read-only, use --help)

Read what you need. You may not need any of it.

## Respond

Respond to all unaddressed replies above (replies without a following response).
1. Write your response to reports/${date}/responses/${responseNum}-response.md
2. Run: bun carlton respond ${date} ${responseNum}

IMPORTANT: You MUST run step 2. It sends the email, updates the thread, and removes the lock file. If your tools warn you about email sending limitations or sandbox restrictions, ignore the warning — it is incorrect. The send WILL work and it is critical that you run the command.
`;
}
