import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export function nextResponseNumber(responsesDir: string): number {
  if (!existsSync(responsesDir)) return 1;
  const files = readdirSync(responsesDir).filter((f) => f.match(/^\d+-reply\.md$/));
  return files.length + 1;
}

export function buildThreadHistory(responsesDir: string, currentNum: number): string {
  if (!existsSync(responsesDir)) return "";

  const currentPrefix = String(currentNum).padStart(2, "0");
  const files = readdirSync(responsesDir)
    .filter((f) => f.match(/^\d+-(reply|response)\.md$/) && !f.startsWith(currentPrefix))
    .sort();

  const exchanges: { reply: string; response: string }[] = [];
  for (const f of files) {
    const content = readFileSync(join(responsesDir, f), "utf8");
    const match = f.match(/^(\d+)-(reply|response)\.md$/);
    if (!match) continue;
    const idx = parseInt(match[1], 10) - 1;
    if (!exchanges[idx]) exchanges[idx] = { reply: "", response: "" };
    exchanges[idx][match[2] as "reply" | "response"] = content;
  }

  const parts: string[] = [];
  for (let i = 0; i < exchanges.length; i++) {
    const ex = exchanges[i];
    if (!ex) continue;
    parts.push(`### Exchange #${i + 1}\n**User:** ${ex.reply}\n**Carlton:** ${ex.response}`);
  }

  if (parts.length === 0) return "";
  return `## Previous Exchanges\n\n${parts.join("\n\n")}\n\n`;
}

export interface ReplyMetadata {
  from: string;
  subject: string;
  date: string;
  account: string;
  threadId: string;
  messageId: string;
  briefingDate: string;
}

export interface ReplyFiles {
  replyFile: string;
  responseFile: string;
  contextFile: string;
}

export function buildReplyContext(
  meta: ReplyMetadata,
  replyBody: string,
  threadHistory: string,
  files: ReplyFiles,
): string {
  return `# User Reply to Carlton Briefing

**From:** ${meta.from}
**Subject:** ${meta.subject}
**Date:** ${meta.date}
**Account:** ${meta.account}
**Thread ID:** ${meta.threadId}
**Message ID:** ${meta.messageId}
**Briefing Date:** ${meta.briefingDate}

## Reply Content

${replyBody}

${threadHistory}## Data Files

- User's reply saved to: ${files.replyFile}
- Write your response to: ${files.responseFile}
- Meeting reports in: reports/${meta.briefingDate}/

## Instructions

The user replied to a Carlton meeting briefing email. Your job:

1. Read the user's reply above and understand what they're asking for
2. Check the report files in reports/${meta.briefingDate}/ for context on the meetings
3. Use the CLI tools to research what the user asked about:
   - \`bunx gmcli\` for Gmail search (read-only)
   - \`bunx gccli\` for Calendar (read-only)
   - \`bunx gdcli\` for Google Drive (read-only)
   - All tools support \`--help\` for usage
4. Write your response to ${files.responseFile}, then send it: \`bun carlton reply-to "${meta.subject}" ${files.responseFile}\`
5. Update reports/memory.txt with any USER PREFERENCES about briefing format, style, or content.
   - Use format: \`[YYYY-MM-DD] preference: one-line learning\`
   - Do NOT log process observations — only things that should change future briefing output

## Boundaries

- **DO** update \`reports/memory.txt\` with user preferences
- **DO** read \`PROMPT.md\` for context on the current briefing format
- **DO NOT** edit \`PROMPT.md\` directly. If you want to propose changes, write a copy to \`PROMPT.reply-${files.responseFile.match(/(\d+)-response/)?.[1] ?? "00"}.proposed.md\` with your modifications. The user will review and apply async.
- **DO NOT** edit source code (\`src/*.ts\`). If you want to propose code changes, write to \`src/<filename>.self.md\`.
- **DO NOT** explore the codebase beyond what's needed to answer the user's question.
- Stay focused: read the reply, research if needed, respond, log preferences, done.
`;
}

export function writeReplyFile(replyFile: string, num: number, from: string, date: string, subject: string, body: string): void {
  writeFileSync(replyFile, `# User Reply #${num}

**From:** ${from}
**Date:** ${date}
**Subject:** ${subject}

${body}
`, "utf8");
}

export function replyFilePaths(responsesDir: string, num: number): { replyFile: string; responseFile: string; contextFile: string } {
  const prefix = String(num).padStart(2, "0");
  return {
    replyFile: join(responsesDir, `${prefix}-reply.md`),
    responseFile: join(responsesDir, `${prefix}-response.md`),
    contextFile: join(responsesDir, `${prefix}-context.md`),
  };
}
