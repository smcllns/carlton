#!/usr/bin/env bun
/**
 * Carlton - Meeting prep assistant
 *
 * Usage:
 *   bun carlton                          # Prep for tomorrow's meetings
 *   bun carlton 2026-02-10              # Prep for a specific date
 *   bun carlton send                    # Email tomorrow's briefing via Resend
 *   bun carlton send 2026-02-10         # Email briefing for specific date
 *   bun carlton serve                   # Poll for email replies, spawn Claude
 *   bun carlton reply-to <subj> <file>  # Send a threaded reply via Resend
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
import { sendBriefing, sendReply } from "./email.ts";
import { getGmail } from "./google.ts";
import { getProjectRoot, getReportsDir } from "./config.ts";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, join } from "path";
import { $ } from "bun";

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

async function gitSnapshot(message: string) {
  const root = getProjectRoot();
  try {
    await $`git -C ${root} add -A`.quiet();
    await $`git -C ${root} commit -m ${message} --allow-empty`.quiet();
  } catch {
    // no changes to commit
  }
}

async function cmdSend(date: string) {
  console.log(`Carlton - Sending briefing for ${date}\n`);

  const prompt = loadPrompt();
  const { events, reports } = await prepBriefing(date);

  if (events.length === 0) {
    console.log("No meetings found for this date. Nothing to send.");
    return;
  }

  console.log(`Found ${events.length} meeting(s). Preparing email...\n`);

  const combined = reports.map((r) => r.content).join("\n\n---\n\n");
  const subject = `Carlton: ${date} Meeting Briefing (${events.length} meetings)`;

  await gitSnapshot(`Send briefing: ${date} (${events.length} meetings).`);

  const messageId = await sendBriefing(prompt.delivery.email, subject, combined);
  console.log(`✅ Briefing sent to ${prompt.delivery.email}`);
  console.log(`   Message ID: ${messageId}`);
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

function nextResponseNumber(responsesDir: string): number {
  if (!existsSync(responsesDir)) return 1;
  const files = readdirSync(responsesDir).filter((f) => f.match(/^\d+-reply\.md$/));
  return files.length + 1;
}

async function handleReply(account: string, threadId: string, msg: any) {
  const gmail = getGmail();
  const projectRoot = getProjectRoot();

  let replyBody = msg.snippet || "";
  try {
    const fullThread = await gmail.getThread(account, threadId);
    if (!Array.isArray(fullThread) && fullThread.messages) {
      const fullMsg = fullThread.messages.find((m: any) => m.id === msg.id);
      if (fullMsg) replyBody = extractMessageBody(fullMsg);
    }
  } catch (err: any) {
    console.error(`  Could not fetch full thread: ${err.message}`);
  }

  const date = parseDateFromSubject(msg.subject || "") || getTomorrow();
  const responsesDir = join(getReportsDir(), date, "responses");
  mkdirSync(responsesDir, { recursive: true });

  const num = nextResponseNumber(responsesDir);
  const replyFile = join(responsesDir, `${String(num).padStart(2, "0")}-reply.md`);
  const responseFile = join(responsesDir, `${String(num).padStart(2, "0")}-response.md`);

  writeFileSync(replyFile, `# User Reply #${num}

**From:** ${msg.from}
**Date:** ${msg.date || new Date().toISOString()}
**Subject:** ${msg.subject}

${replyBody}
`, "utf8");

  const contextFile = join(projectRoot, ".carlton-reply.md");
  const context = `# User Reply to Carlton Briefing

**From:** ${msg.from}
**Subject:** ${msg.subject}
**Date:** ${msg.date || new Date().toISOString()}
**Account:** ${account}
**Thread ID:** ${threadId}
**Message ID:** ${msg.id}
**Briefing Date:** ${date}

## Reply Content

${replyBody}

## Data Files

- User's reply saved to: ${replyFile}
- Write your response to: ${responseFile}
- Meeting reports in: reports/${date}/

## Instructions

The user replied to a Carlton meeting briefing email. Your job:

1. Read the user's reply above and understand what they're asking for
2. Check the report files in reports/${date}/ for context on the meetings
3. Use the CLI tools to research what the user asked about:
   - \`bunx gmcli\` for Gmail search (read-only)
   - \`bunx gccli\` for Calendar (read-only)
   - \`bunx gdcli\` for Google Drive (read-only)
   - All tools support \`--help\` for usage
4. Update the relevant report file with your findings
5. Write your response to ${responseFile}, then send it: \`bun carlton reply-to "${msg.subject}" ${responseFile}\`
6. Log what you learned to reports/memory.txt
`;

  writeFileSync(contextFile, context, "utf8");

  console.log(`🤖 Spawning Claude to handle reply...`);
  try {
    const proc = Bun.spawn(
      ["claude", "A user replied to a Carlton briefing email. Read .carlton-reply.md for the full context and instructions."],
      {
        cwd: projectRoot,
        stdio: ["inherit", "inherit", "inherit"],
      }
    );
    await proc.exited;
    console.log(`✅ Claude finished handling reply`);
  } catch (err: any) {
    console.error(`❌ Claude failed: ${err.message}`);
  }
}

async function cmdServe() {
  const prompt = loadPrompt();
  const gmail = getGmail();
  const accounts = gmail.listAccounts().map((a: any) => a.email);

  if (accounts.length === 0) {
    throw new Error("No Gmail accounts configured. Run: bun carlton auth");
  }

  console.log("Carlton - Listening for email replies...");
  console.log(`  Monitoring: ${accounts.join(", ")}`);
  console.log(`  Delivery to: ${prompt.delivery.email}\n`);

  const idsFile = join(getProjectRoot(), ".carlton-processed-ids");
  const processedIds = new Set<string>(
    existsSync(idsFile)
      ? readFileSync(idsFile, "utf8").split("\n").filter(Boolean)
      : []
  );
  const persistIds = () => writeFileSync(idsFile, [...processedIds].join("\n"), "utf8");

  const POLL_INTERVAL = 30_000;
  let busy = false;

  const poll = async () => {
    if (busy) return;

    for (const account of accounts) {
      try {
        const results = await gmail.searchThreads(
          account,
          "subject:(Carlton Meeting Briefing)",
          10
        );

        for (const thread of results.threads) {
          for (const msg of thread.messages) {
            if (processedIds.has(msg.id)) continue;
            processedIds.add(msg.id);

            const isFromUser = !msg.from?.includes("resend.dev");
            if (!isFromUser) continue;

            console.log(`📩 Reply from ${msg.from}: ${msg.subject}`);
            console.log(`   "${(msg.snippet || "").slice(0, 100)}"`);
            persistIds();

            busy = true;
            await handleReply(account, thread.id, msg);
            busy = false;
          }
        }
      } catch (err: any) {
        console.error(`  Error polling ${account}: ${err.message}`);
      }
    }
  };

  while (true) {
    await poll();
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

async function cmdReplyTo(subject: string, bodyFile: string) {
  const prompt = loadPrompt();
  const body = readFileSync(bodyFile, "utf8");

  await gitSnapshot(`Send reply: ${subject.slice(0, 60)}.`);

  const messageId = await sendReply(prompt.delivery.email, subject, body, "");
  console.log(`✅ Reply sent to ${prompt.delivery.email}`);
  console.log(`   Message ID: ${messageId}`);
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
  const date = args[1] && isValidDate(args[1]) ? args[1] : getTomorrow();
  await cmdSend(date);
} else if (command === "serve") {
  await cmdServe();
} else if (command === "reply-to") {
  const subject = args[1];
  const bodyFile = args[2];
  if (!subject || !bodyFile) {
    console.error("Usage: bun carlton reply-to <subject> <body-file.md>");
    process.exit(1);
  }
  await cmdReplyTo(subject, bodyFile);
} else if (isValidDate(command)) {
  await cmdPrep(command);
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: bun carlton [date|setup|auth|credentials|accounts add <email>|send [date]|serve|reply-to <subject> <file>]");
  process.exit(1);
}
