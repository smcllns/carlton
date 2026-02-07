#!/usr/bin/env bun
/**
 * Carlton - Meeting prep assistant
 *
 * Usage:
 *   bun carlton                          # Prep for tomorrow's meetings
 *   bun carlton 2026-02-10              # Prep for a specific date
 *   bun carlton setup                   # Check auth status
 *   bun carlton auth                    # Show setup instructions
 *   bun carlton credentials             # Register OAuth credentials
 *   bun carlton accounts add you@gmail  # Add account to all services
 */

import { checkAuth } from "./google.ts";
import { getEventsForDate } from "./calendar.ts";
import {
  createReportFiles,
  writeReport,
  formatBasicReport,
} from "./report.ts";
import { existsSync, readdirSync } from "fs";
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
  const credDir = resolve(import.meta.dir, "../credentials");
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

async function cmdPrep(date: string) {
  console.log(`Carlton - Preparing for ${date}\n`);

  // Check auth first
  const auth = checkAuth();
  if (auth.calendar.length === 0) {
    console.error("No calendar accounts configured. Run: bun carlton auth");
    process.exit(1);
  }

  console.log(
    `Checking calendars for: ${auth.calendar.join(", ")}\n`
  );

  // Fetch events
  const events = await getEventsForDate(date);

  if (events.length === 0) {
    console.log("No meetings found for this date.");
    return;
  }

  console.log(`Found ${events.length} meeting(s):\n`);

  // Create report files
  const paths = createReportFiles(date, events);

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const filepath = paths[i];

    console.log(
      `  ${formatTimeShort(event.start)} ${event.summary} (${event.attendees.length} attendees)`
    );

    // Write basic report (Milestone 1-2: just calendar data)
    const content = formatBasicReport(event);
    writeReport(filepath, content);
  }

  console.log(`\nReports written to: reports/${date}/`);
}

function formatTimeShort(iso: string): string {
  if (!iso.includes("T")) return iso;
  const match = iso.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : iso;
}

// --- Main ---

const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  await cmdPrep(getTomorrow());
} else if (command === "setup") {
  await cmdSetup();
} else if (command === "auth") {
  cmdAuth();
} else if (command === "credentials") {
  await cmdCredentials();
} else if (command === "accounts" && args[1] === "add") {
  await cmdAccountsAdd(args[2]);
} else if (isValidDate(command)) {
  await cmdPrep(command);
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: bun carlton [date|setup|auth|credentials|accounts add <email>]");
  process.exit(1);
}
