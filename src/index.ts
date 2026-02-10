#!/usr/bin/env bun

import { checkAuth } from "./google.ts";
import { getEventsForDate, type CalendarEvent } from "./calendar.ts";
import { loadPrompt } from "./prompt.ts";
import { sendBriefing, type BriefingSentResult } from "./email.ts";
import { getProjectRoot, getReportsDir } from "./config.ts";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, unlinkSync } from "fs";
import { join } from "path";
import { $ } from "bun";
import { runResearch } from "./research.ts";
import { runCurator } from "./curator.ts";

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

async function prepBriefing(date: string): Promise<CalendarEvent[]> {
  const auth = checkAuth();
  if (auth.calendar.length === 0) {
    throw new Error("No calendar accounts configured. Run: bun carlton auth");
  }

  console.log(`Checking calendars for: ${auth.calendar.join(", ")}\n`);

  const dateDir = join(getReportsDir(), date);
  mkdirSync(dateDir, { recursive: true });

  return getEventsForDate(date);
}

async function cmdPrep(date: string) {
  console.log(`Carlton - Preparing for ${date}\n`);

  const events = await prepBriefing(date);

  if (events.length === 0) {
    console.log("No meetings found for this date.");
    return;
  }

  console.log(`Found ${events.length} meeting(s):\n`);

  for (const event of events) {
    console.log(
      `  ${formatTimeShort(event.start)} ${event.summary} (${event.attendees.length} attendees)`
    );
  }
}

async function cmdSend(date: string) {
  console.log(`Carlton - Preparing briefing for ${date}\n`);

  const prompt = loadPrompt();
  const events = await prepBriefing(date);

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

  const auth = checkAuth();
  const authedAccounts = new Set([...auth.gmail, ...auth.calendar, ...auth.drive]);
  const validAccounts = prompt.accounts.filter((a) => authedAccounts.has(a));
  if (validAccounts.length === 0) {
    throw new Error(
      `None of the configured accounts are authenticated: ${prompt.accounts.join(", ")}.\n` +
      `Authenticated accounts: ${[...authedAccounts].join(", ") || "(none)"}.\n` +
      `Run: bun carlton auth`
    );
  }

  console.log("Running research on each meeting...\n");
  const researchResults = await runResearch(date, events, prompt);

  const succeeded = researchResults.filter((r) => r.success).length;
  const failed = researchResults.filter((r) => !r.success).length;
  console.log(`Research complete: ${succeeded} succeeded, ${failed} failed.\n`);

  if (succeeded === 0) {
    throw new Error(`All ${failed} research tasks failed. Not running curator on empty research.`);
  }

  const curatorOk = await runCurator(date, prompt);
  if (!curatorOk) {
    throw new Error("Curator failed. No briefing to send.");
  }

  await cmdSendBriefing(date);
}

async function cmdSendBriefing(date: string) {
  const prompt = loadPrompt();
  const briefingFile = join(getReportsDir(), date, "briefing.md");
  const sentMarker = join(getReportsDir(), date, ".briefing-sent");

  if (existsSync(sentMarker)) {
    console.log(`Briefing for ${date} was already sent. Skipping.`);
    return;
  }

  if (!existsSync(briefingFile)) {
    throw new Error(`No briefing found at ${briefingFile}. Run 'bun carlton send ${date}' first.`);
  }

  const markdown = readFileSync(briefingFile, "utf8");
  const subject = prompt.subjectPattern
    ? prompt.subjectPattern.replace(/YYYY-MM-DD/g, date)
    : `[${date}] Briefing`;
  const result = await sendBriefing(prompt.delivery.email, subject, markdown, date);
  writeFileSync(sentMarker, JSON.stringify(result), "utf8");

  console.log(`✅ Briefing sent to ${prompt.delivery.email}`);
  console.log(`   Message ID: ${result.messageId}`);
}

function formatTimeShort(iso: string): string {
  if (!iso.includes("T")) return iso;
  const match = iso.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : iso;
}

function cmdReset() {
  const reportsDir = getReportsDir();
  const deleted: string[] = [];

  if (existsSync(reportsDir)) {
    const entries = readdirSync(reportsDir).filter((f) => f !== ".gitkeep");
    for (const entry of entries) {
      rmSync(join(reportsDir, entry), { recursive: true, force: true });
      deleted.push(`reports/${entry}`);
    }
  }

  if (deleted.length === 0) {
    console.log("Nothing to reset.");
  } else {
    console.log("Deleted:");
    for (const d of deleted) console.log(`  ${d}`);
    console.log(`\nAuth untouched (~/.gccli, ~/.gmcli, ~/.gdcli).`);
  }
}

function cmdHelp() {
  console.log(`Carlton - Meeting prep assistant

Usage: bun carlton <command> [options]

Commands:
  (none)                        Prep + send briefing for tomorrow
  send [date]                   Research + curate + send briefing (default: tomorrow)
  send [date] --resend          Re-launch curator, keep existing research
  send [date] --test            Nuke date folder, full fresh run
  send-briefing [date]          Send briefing.md as email
  [date]                        List events for a date (no research/send)
  reset                         Wipe all reports (keeps auth)

Setup:
  auth                          Show setup instructions
  credentials                   Register OAuth credentials
  accounts add <email>          Add a Google account
  setup                         Check auth status
  help                          Show this help

Dates are YYYY-MM-DD format. Defaults to tomorrow if omitted.`);
}

// --- Main ---

const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  await cmdSend(getTomorrow());
} else if (command === "help" || command === "--help" || command === "-h") {
  cmdHelp();
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
  const resendMode = args.includes("--resend");
  const dateArg = args.slice(1).find(a => !a.startsWith("--"));
  const date = dateArg && isValidDate(dateArg) ? dateArg : getTomorrow();
  if (testMode) {
    const dateDir = join(getReportsDir(), date);
    if (existsSync(dateDir)) {
      rmSync(dateDir, { recursive: true, force: true });
      console.log(`Cleared reports/${date}/ for fresh run.`);
    }
  } else if (resendMode) {
    const sentMarker = join(getReportsDir(), date, ".briefing-sent");
    const briefingFile = join(getReportsDir(), date, "briefing.md");
    if (existsSync(sentMarker)) unlinkSync(sentMarker);
    if (existsSync(briefingFile)) unlinkSync(briefingFile);
    console.log(`Cleared briefing for ${date}. Re-running curator with existing research.`);
  }
  await cmdSend(date);
} else if (command === "send-briefing") {
  const date = args[1] && isValidDate(args[1]) ? args[1] : getTomorrow();
  await cmdSendBriefing(date);
} else if (command === "reset") {
  cmdReset();
} else if (isValidDate(command)) {
  await cmdPrep(command);
} else {
  console.error(`Unknown command: ${command}`);
  cmdHelp();
  process.exit(1);
}
