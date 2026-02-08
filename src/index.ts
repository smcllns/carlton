#!/usr/bin/env bun
/**
 * Carlton - Meeting prep assistant
 *
 * Usage:
 *   bun carlton                          # Prep for tomorrow's meetings
 *   bun carlton 2026-02-10              # Prep for a specific date
 *   bun carlton send                    # Email tomorrow's briefing via Resend
 *   bun carlton send 2026-02-10         # Email briefing for specific date
 *   bun carlton serve                   # Poll for replies, spawn Claude in tmux windows (requires tmux)
 *   bun carlton send-briefing 2026-02-10 # Send reports/<date>/briefing.md via email
 *   bun carlton reply-to <subj> <file> <date>  # Send a threaded reply via Resend
 *   bun carlton reset                   # Wipe reports, memory, processed IDs (keeps auth)
 *   bun carlton setup                   # Check auth status
 *   bun carlton auth                    # Show setup instructions
 *   bun carlton credentials             # Register OAuth credentials
 *   bun carlton accounts add you@gmail  # Add account to all services
 */

import { checkAuth } from "./google.ts";
import { getEventsForDate, type CalendarEvent } from "./calendar.ts";
import {
  createReportFiles,
  writeReport,
  formatBasicReport,
} from "./report.ts";
import { loadPrompt, type PromptConfig } from "./prompt.ts";
import { sendBriefing, sendReply, extractMessageId, type BriefingSentResult } from "./email.ts";
import { getGmail } from "./google.ts";
import { getProjectRoot, getReportsDir } from "./config.ts";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, unlinkSync, appendFileSync } from "fs";
import {
  nextResponseNumber,
  writeReplyFile,
  replyFilePaths,
  hasUnprocessedReplies,
  appendToThread,
  buildReplyPrompt,
} from "./reply.ts";
import {
  triggerProcessing,
  cleanStaleLocks,
  recordReplyDirect,
} from "./serve.ts";
import { join } from "path";
import { createHash } from "crypto";
import { $ } from "bun";
import { runResearch } from "./research.ts";
import { buildCuratorContext, runCurator } from "./curator.ts";

function getTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

async function cmdSetup() {
  console.log("Carlton - Auth Status\n");

  const auth = checkAuth();

  const show = (name: string, emails: string[]) => {
    if (emails.length === 0) {
      console.log(`  ${name}: not configured`);
    } else {
      console.log(`  ${name}: ${emails.join(", ")}`);
    }
  };

  show("Calendar (gccli)", auth.calendar);
  show("Gmail (gmcli)", auth.gmail);
  show("Drive (gdcli)", auth.drive);

  const allGood =
    auth.calendar.length > 0 &&
    auth.gmail.length > 0 &&
    auth.drive.length > 0;

  if (!allGood) {
    console.log(
      "\nSome services are not configured. Run `bun carlton auth` for setup instructions."
    );
  } else {
    console.log("\nAll services configured. Ready to go.");
  }
}

function cmdAuth() {
  console.log(`Carlton - Setup Instructions

Prerequisites:
  - tmux (brew install tmux)
  - bun (brew install oven-sh/bun/bun)
  - claude (npm install -g @anthropic-ai/claude-code)
  - gh (brew install gh, then: gh auth login)

Carlton uses three CLI tools to access your Google data (read-only):
  - gccli (Google Calendar)
  - gmcli (Gmail)
  - gdcli (Google Drive)

Each tool stores its credentials separately in ~/.gccli/, ~/.gmcli/, ~/.gdcli/.
You need ONE Google Cloud project with all three APIs enabled.

STEP 1: Get Google Cloud OAuth Client Credentials
──────────────────────────────────────────────────
You can give this prompt to ChatGPT or Claude to walk you through it:

  "Help me set up a Google Cloud project for a personal meeting prep tool.
   I need to:
   1. Create a new Google Cloud project (or use existing)
   2. Enable these APIs: Gmail API, Google Calendar API, Google Drive API
   3. Configure OAuth consent screen (internal or external with test users)
   4. Add my email address(es) as test users
   5. Create an OAuth 2.0 Desktop App client
   6. Download the credentials JSON file

   The app only needs READONLY access. Walk me through each step
   with links to the right Google Cloud Console pages."

STEP 2: Set up credentials in your repo
────────────────────────────────────────
Drop your credentials JSON into the credentials/ folder:

  carlton/
  ├── credentials/
  │   └── your-client-secret.json   ← put it here
  ├── src/
  ├── package.json
  └── ...

Then run:
  bun carlton credentials

STEP 3: Login with your Google accounts to set up access tokens
───────────────────────────────────────────────────────────────
  bun carlton accounts add you@gmail.com

This registers your account with all three tools. Each will open a
browser for OAuth consent. Repeat for additional accounts.

STEP 4: Verify auth setup and permissions
──────────────────────────────────────────
  bun carlton setup
`);
}

async function cmdCredentials() {
  const credDir = join(getProjectRoot(), "credentials");
  const jsonFiles = readdirSync(credDir).filter(f => f.endsWith(".json") && f !== ".gitkeep" && f !== "example.json");

  if (jsonFiles.length === 0) {
    console.error("❌ No .json file found in credentials/");
    console.error("   Download it from Google Cloud Console and drop it there.");
    process.exit(1);
  }

  if (jsonFiles.length > 1) {
    console.error("❌ Multiple .json files found in credentials/ — expected one:");
    jsonFiles.forEach(f => console.error(`   ${f}`));
    process.exit(1);
  }

  const credPath = join(credDir, jsonFiles[0]);
  console.log(`Using: ${jsonFiles[0]}\n`);

  const tools = [
    { cmd: "gccli", label: "Google Calendar" },
    { cmd: "gmcli", label: "Gmail" },
    { cmd: "gdcli", label: "Google Drive" },
  ];

  let allGood = true;
  for (const { cmd, label } of tools) {
    try {
      await $`bunx ${cmd} accounts credentials ${credPath}`.quiet();
      console.log(`✅ ${label} (${cmd}) — credentials registered`);
    } catch (e: any) {
      console.error(`❌ ${label} (${cmd}) — failed: ${e.stderr?.toString().trim() || e.message}`);
      allGood = false;
    }
  }

  if (allGood) {
    console.log(`\nAll good. Next, add your account(s):`);
    console.log(`  bun carlton accounts add you@gmail.com`);
  } else {
    console.log(`\nSome tools failed. Check the errors above.`);
    process.exit(1);
  }
}

async function cmdAccountsAdd(email: string) {
  if (!email || !email.includes("@")) {
    console.error("Usage: bun carlton accounts add you@gmail.com");
    process.exit(1);
  }

  const tools = [
    { cmd: "gccli", label: "Google Calendar" },
    { cmd: "gmcli", label: "Gmail" },
    { cmd: "gdcli", label: "Google Drive" },
  ];

  console.log(`Adding ${email} to all services...\n`);

  for (const { cmd, label } of tools) {
    console.log(`── ${label} (${cmd}) ──`);
    try {
      await $`bunx ${cmd} accounts add ${email}`;
      console.log(`✅ ${label} done\n`);
    } catch (e: any) {
      console.error(`❌ ${label} failed\n`);
      process.exit(1);
    }
  }

  console.log(`All done. Verify with: bun carlton setup`);
}

interface PrepResult {
  events: CalendarEvent[];
  reports: { event: CalendarEvent; content: string; filepath: string }[];
}

async function prepBriefing(date: string): Promise<PrepResult> {
  const auth = checkAuth();
  if (auth.calendar.length === 0) {
    throw new Error("No calendar accounts configured. Run: bun carlton auth");
  }

  console.log(`Checking calendars for: ${auth.calendar.join(", ")}\n`);

  const events = await getEventsForDate(date);

  if (events.length === 0) {
    return { events: [], reports: [] };
  }

  const paths = createReportFiles(date, events);
  const reports: PrepResult["reports"] = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const filepath = paths[i];
    const content = formatBasicReport(event);
    writeReport(filepath, content);
    reports.push({ event, content, filepath });
  }

  return { events, reports };
}

async function cmdPrep(date: string) {
  console.log(`Carlton - Preparing for ${date}\n`);

  const { events, reports } = await prepBriefing(date);

  if (events.length === 0) {
    console.log("No meetings found for this date.");
    return;
  }

  console.log(`Found ${events.length} meeting(s):\n`);

  for (const { event } of reports) {
    console.log(
      `  ${formatTimeShort(event.start)} ${event.summary} (${event.attendees.length} attendees)`
    );
  }

  console.log(`\nReports written to: reports/${date}/`);
}

async function cmdSend(date: string) {
  console.log(`Carlton - Preparing briefing for ${date}\n`);

  const prompt = loadPrompt();
  const { events, reports } = await prepBriefing(date);

  if (events.length === 0) {
    console.log("No meetings found for this date. Nothing to send.");
    return;
  }

  console.log(`Found ${events.length} meeting(s).\n`);

  const sentMarker = join(getReportsDir(), date, ".briefing-sent");
  if (existsSync(sentMarker)) {
    console.log(`Briefing for ${date} was already sent. Skipping.`);
    return;
  }

  console.log("Running research on each meeting...\n");
  const researchResults = await runResearch(date, events, prompt);

  const succeeded = researchResults.filter((r) => r.success).length;
  const failed = researchResults.filter((r) => !r.success).length;
  console.log(`Research complete: ${succeeded} succeeded, ${failed} failed.\n`);

  const contextFile = join(getReportsDir(), date, "curator-context.md");
  const context = buildCuratorContext(date, events, researchResults, prompt);
  writeFileSync(contextFile, context, "utf8");
  console.log(`Curator context written to: ${contextFile}\n`);

  const exitCode = await runCurator(date, contextFile);

  if (exitCode !== 0) {
    console.error(`❌ Curator exited with code ${exitCode}.`);
    process.exit(1);
  }

  if (existsSync(sentMarker)) {
    const messageId = readFileSync(sentMarker, "utf8").trim();
    console.log(`✅ Briefing sent! (${messageId})`);
  } else {
    console.error("⚠️  Curator finished but briefing wasn't sent. Check reports/ for details.");
  }
}

async function cmdSendBriefing(date: string) {
  const prompt = loadPrompt();
  const briefingFile = join(getReportsDir(), date, "briefing.md");
  const sentMarker = join(getReportsDir(), date, ".briefing-sent");
  const threadFile = join(getReportsDir(), date, "thread.md");

  if (existsSync(sentMarker)) {
    console.log(`Briefing for ${date} was already sent. Skipping.`);
    return;
  }

  if (!existsSync(briefingFile)) {
    throw new Error(`No briefing found at ${briefingFile}. Run 'bun carlton send ${date}' first.`);
  }

  const markdown = readFileSync(briefingFile, "utf8");
  const subject = `${date} Carlton Briefing Notes`;
  const result = await sendBriefing(prompt.delivery.email, subject, markdown, date);
  writeFileSync(sentMarker, JSON.stringify(result), "utf8");

  // Create thread.md with briefing content
  const threadContent = `# Carlton Thread — ${date}

## Briefing Sent (${new Date().toISOString()})

${markdown}

---
`;
  writeFileSync(threadFile, threadContent, "utf8");

  console.log(`✅ Briefing sent to ${prompt.delivery.email}`);
  console.log(`   Message ID: ${result.messageId}`);
}


function replyContentHash(msg: any): string {
  if (msg.id) return msg.id;
  const input = [msg.from || "", msg.subject || "", msg.date || ""].join("|");
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function extractMessageBody(message: any): string {
  const payload = message.payload;
  if (!payload) return message.snippet || "";

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString("utf8");
      }
      if (part.parts) {
        for (const subpart of part.parts) {
          if (subpart.mimeType === "text/plain" && subpart.body?.data) {
            return Buffer.from(subpart.body.data, "base64url").toString("utf8");
          }
        }
      }
    }
  }

  return message.snippet || "";
}

function parseDateFromSubject(subject: string): string | null {
  const match = subject.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/**
 * Record a reply: fetch full body from Gmail, write NN-reply.md and append to thread.md
 */
async function recordReply(account: string, threadId: string, msg: any) {
  const gmail = getGmail();

  let replyBody = msg.snippet || "";
  let replyMessageId = "";
  try {
    const fullThread = await gmail.getThread(account, threadId);
    if (!Array.isArray(fullThread) && fullThread.messages) {
      const fullMsg = fullThread.messages.find((m: any) => m.id === msg.id);
      if (fullMsg) {
        replyBody = extractMessageBody(fullMsg);
        replyMessageId = extractMessageId(fullMsg);
      }
    }
  } catch (err: any) {
    console.error(`  Could not fetch full thread: ${err.message}`);
  }

  const msgDate = msg.date || new Date().toISOString();
  return recordReplyDirect(msg.from, msg.subject || "", msgDate, replyBody, replyMessageId);
}

async function cmdServe() {
  if (!process.env.TMUX) {
    throw new Error("serve must run inside tmux. Start a tmux session first: tmux new -s carlton");
  }

  const prompt = loadPrompt();
  const gmail = getGmail();
  const accounts = gmail.listAccounts().map((a: any) => a.email);

  if (accounts.length === 0) {
    throw new Error("No Gmail accounts configured. Run: bun carlton auth");
  }

  console.log("Carlton - Listening for email replies...");
  console.log(`  Monitoring: ${accounts.join(", ")}`);
  console.log(`  Delivery to: ${prompt.delivery.email}\n`);

  // On startup: clean stale locks
  cleanStaleLocks();

  // On startup: trigger processing for any dates with unprocessed replies
  const reportsDir = getReportsDir();
  if (existsSync(reportsDir)) {
    const dates = readdirSync(reportsDir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    for (const date of dates) {
      triggerProcessing(date);
    }
  }

  const idsFile = join(getProjectRoot(), ".carlton-processed-ids");
  const processedIds = new Set<string>(
    existsSync(idsFile)
      ? readFileSync(idsFile, "utf8").split("\n").filter(Boolean)
      : []
  );
  const persistIds = () => writeFileSync(idsFile, [...processedIds].join("\n"), "utf8");

  const POLL_INTERVAL = 30_000;

  // Seed: mark all existing messages as processed so we only react to new ones
  for (const account of accounts) {
    try {
      const results = await gmail.searchThreads(account, "subject:(Carlton Briefing Notes)", 10);
      for (const thread of results.threads) {
        for (const msg of thread.messages) {
          processedIds.add(replyContentHash(msg));
        }
      }
    } catch (err: any) {
      console.error(`  Error seeding ${account}: ${err.message}`);
    }
  }
  persistIds();
  console.log(`  Seeded ${processedIds.size} existing messages.\n`);

  const poll = async () => {
    const pending: { account: string; threadId: string; msg: any }[] = [];
    const datesToProcess = new Set<string>();

    for (const account of accounts) {
      try {
        const results = await gmail.searchThreads(
          account,
          "subject:(Carlton Briefing Notes)",
          10
        );

        for (const thread of results.threads) {
          for (const msg of thread.messages) {
            const hash = replyContentHash(msg);
            if (processedIds.has(hash)) continue;
            processedIds.add(hash);

            const isDraft = msg.labelIds?.includes("DRAFT");
            if (isDraft) continue;

            const isFromUser = !msg.from?.includes("resend.dev");
            if (!isFromUser) continue;

            pending.push({ account, threadId: thread.id, msg });
          }
        }
      } catch (err: any) {
        console.error(`  Error polling ${account}: ${err.message}`);
      }
    }

    pending.sort((a, b) => {
      const dateA = new Date(a.msg.date || a.msg.internalDate || 0).getTime();
      const dateB = new Date(b.msg.date || b.msg.internalDate || 0).getTime();
      return dateA - dateB;
    });

    // Record all replies first (mechanical)
    for (const { account, threadId, msg } of pending) {
      console.log(`📩 Reply from ${msg.from}: ${msg.subject}`);
      console.log(`   "${(msg.snippet || "").slice(0, 100)}"`);
      persistIds();

      const date = await recordReply(account, threadId, msg);
      datesToProcess.add(date);
    }

    // Then trigger processing for each date (fire and forget)
    for (const date of datesToProcess) {
      triggerProcessing(date);
    }
  };

  while (true) {
    await poll();
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

async function cmdReplyTo(subject: string, bodyFile: string, date: string) {
  const prompt = loadPrompt();
  const body = readFileSync(bodyFile, "utf8");
  const replyIdFile = join(getReportsDir(), date, "responses", ".last-reply-id");
  const threadFile = join(getReportsDir(), date, "thread.md");

  // Read the reply's Gmail Message-ID for threading (thread to user's reply, not briefing)
  let inReplyTo = "";
  if (existsSync(replyIdFile)) {
    inReplyTo = readFileSync(replyIdFile, "utf8").trim();
  }

  const resendId = await sendReply(prompt.delivery.email, subject, body, inReplyTo);

  // Append response to thread.md
  if (existsSync(threadFile)) {
    const responseNum = bodyFile.match(/(\d+)-response\.md/)?.[1] || "00";
    const responseSection = `
## Response to Reply #${parseInt(responseNum, 10)}

${body}

---
`;
    appendFileSync(threadFile, responseSection, "utf8");

    // Remove NEW markers from thread.md
    let threadContent = readFileSync(threadFile, "utf8");
    threadContent = threadContent.replace(/## NEW Reply/g, "## Reply");
    writeFileSync(threadFile, threadContent, "utf8");
  }

  console.log(`✅ Reply sent to ${prompt.delivery.email}`);
  console.log(`   Resend ID: ${resendId}`);
}

function formatTimeShort(iso: string): string {
  if (!iso.includes("T")) return iso;
  const match = iso.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : iso;
}

async function cmdRun() {
  const date = getTomorrow();
  console.log(`Carlton - Starting up\n`);

  try {
    await cmdSend(date);
  } catch (err: any) {
    console.error(`⚠️  Could not send briefing: ${err.message}\n`);
  }

  console.log("");
  await cmdServe();
}

function cmdReset() {
  const reportsDir = getReportsDir();
  const idsFile = join(getProjectRoot(), ".carlton-processed-ids");

  const deleted: string[] = [];

  if (existsSync(idsFile)) {
    rmSync(idsFile);
    deleted.push(".carlton-processed-ids");
  }

  if (existsSync(reportsDir)) {
    const entries = readdirSync(reportsDir).filter((f) => f !== "memory.txt" && f !== ".gitkeep");
    for (const entry of entries) {
      rmSync(join(reportsDir, entry), { recursive: true, force: true });
      deleted.push(`reports/${entry}`);
    }
  }

  const memoryFile = join(reportsDir, "memory.txt");
  if (existsSync(memoryFile)) {
    rmSync(memoryFile);
    deleted.push("reports/memory.txt");
  }

  if (deleted.length === 0) {
    console.log("Nothing to reset.");
  } else {
    console.log("Deleted:");
    for (const d of deleted) console.log(`  ${d}`);
    console.log(`\nAuth untouched (~/.gccli, ~/.gmcli, ~/.gdcli).`);
  }
}

// --- Main ---

const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  await cmdRun();
} else if (command === "setup") {
  await cmdSetup();
} else if (command === "auth") {
  cmdAuth();
} else if (command === "credentials") {
  await cmdCredentials();
} else if (command === "accounts" && args[1] === "add") {
  await cmdAccountsAdd(args[2]);
} else if (command === "send") {
  const testMode = args.includes("--test");
  const dateArg = args.slice(1).find(a => a !== "--test");
  const date = dateArg && isValidDate(dateArg) ? dateArg : getTomorrow();
  if (testMode) {
    const sentMarker = join(getReportsDir(), date, ".briefing-sent");
    if (existsSync(sentMarker)) {
      unlinkSync(sentMarker);
      console.log(`Cleared sent marker for ${date}.`);
    }
  }
  await cmdSend(date);
} else if (command === "send-briefing") {
  const date = args[1] && isValidDate(args[1]) ? args[1] : getTomorrow();
  await cmdSendBriefing(date);
} else if (command === "serve") {
  await cmdServe();
} else if (command === "reply-to") {
  const subject = args[1];
  const bodyFile = args[2];
  const date = args[3];
  if (!subject || !bodyFile || !date) {
    console.error("Usage: bun carlton reply-to <subject> <body-file.md> <date>");
    process.exit(1);
  }
  await cmdReplyTo(subject, bodyFile, date);
} else if (command === "reset") {
  cmdReset();
} else if (isValidDate(command)) {
  await cmdPrep(command);
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: bun carlton [date|setup|auth|credentials|accounts add <email>|send [date]|send-briefing [date]|serve|reply-to <subject> <file> <date>|reset]");
  process.exit(1);
}
