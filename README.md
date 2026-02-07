# Carlton

Read-only meeting prep CLI. Pulls calendar events across multiple Google accounts and generates briefing docs.

## Prerequisites

- [Bun](https://bun.sh)
- A Google Cloud project with Calendar, Gmail, and Drive APIs enabled

## Setup

```bash
bun install
bun carlton auth                              # See full setup instructions
# Drop your Google Cloud OAuth JSON into credentials/
bun carlton credentials                       # Register with all Google tools
bun carlton accounts add you@gmail.com        # Add account (opens browser for OAuth)
bun carlton setup                             # Verify auth
```

## Usage

```bash
bun carlton                   # Prep for tomorrow
bun carlton 2026-02-10        # Prep for specific date
bun carlton setup             # Check auth status
bun carlton auth              # Setup instructions
bun carlton credentials       # Register OAuth credentials
bun carlton accounts add <e>  # Add a Google account
bun test                      # Run tests
```

Reports are written to `reports/YYYY-MM-DD/HH-MM-meeting-title.md`.

## Overview

Carlton is a read-only meeting prep CLI that:
1. Fetches calendar events for a target day (default: tomorrow) across **multiple Google accounts**
2. Researches each meeting's attendees and context via Gmail, Google Calendar, and Google Drive
3. Generates a meeting briefing `.md` file per meeting
4. Learns user preferences over time via a persistent `memory.txt`

## Core Principles

- **Read-only.** Carlton never sends emails, creates drafts, edits calendar events, or deletes anything. Hard-coded guardrails enforce this.
- **Minimal and inspectable.** The user trusts this tool with sensitive data. Code must be simple, clear, and easy to audit.
- **Multi-account.** The user has many Gmail/Calendar accounts. Carlton checks all of them.
- **Learning system.** Each session appends to `memory.txt` what worked, what didn't, and what the user prefers. Future agents read this before starting.

## Tech Stack

| Component | Choice |
|-----------|--------|
| Runtime | Bun |
| Language | TypeScript |
| Gmail | `@mariozechner/gmcli` (library import) |
| Calendar | `@mariozechner/gccli` (library import) |
| Drive | `@mariozechner/gdcli` (library import) |
| Testing | `bun:test` (TDD) |
| Invocation | `bun carlton` (via package.json scripts) |

## Auth Strategy

- One Google Cloud project with Gmail API, Calendar API, and Drive API enabled
- One OAuth Desktop App client → download credentials JSON
- `bun carlton credentials` registers the same credentials file with all three tools
- `bun carlton accounts add you@gmail.com` adds an account to all three tools in one command
- Tokens stored separately in `~/.gmcli/`, `~/.gccli/`, `~/.gdcli/`
- **Readonly scopes:** Upstream tools currently request full access scopes. Plan: fork the three tools to use readonly scopes (`gmail.readonly`, `calendar.readonly`, `drive.readonly`). Until then, Carlton's code never calls write/send/delete methods and this is documented + tested.

## Folder Structure

```
carlton/
├── credentials/
│   ├── .gitkeep
│   └── *.json            # OAuth credentials (gitignored)
├── src/
│   ├── index.ts          # CLI entry point and all commands
│   ├── config.ts         # Config management
│   ├── google.ts         # Service wrappers (gmail, calendar, drive)
│   ├── calendar.ts       # Multi-account event fetching + dedup
│   ├── report.ts         # Report generation + file output
│   └── *.test.ts         # Tests
├── reports/
│   ├── [YYYY-MM-DD]/
│   │   └── [HH-MM-meeting-title].md
│   └── memory.txt
├── CLAUDE.md             # Agent instructions
├── README.md             # This file
├── package.json
└── tsconfig.json
```

## Milestones

### Milestone 1: Read One Calendar
**Goal:** Prove auth works end-to-end. Fetch events from one calendar account for a given date.

- [x] Project structure (Bun + TS + deps)
- [x] Import gccli CalendarService as library
- [x] CLI: `bun carlton setup` shows auth status
- [x] CLI: `bun carlton auth` shows setup instructions
- [x] **User test:** Run `bun carlton setup`, then `bun carlton 2026-02-09` with configured accounts
- [x] Confirm events are fetched and printed

### Milestone 2: All Calendars + File Output
**Goal:** Fetch events from ALL calendars across ALL accounts. Deduplicate. Output `.md` files.

- [x] Iterate all calendars per account (not just `primary`)
- [x] Deduplicate events appearing in multiple calendars
- [x] Create `reports/YYYY-MM-DD/HH-MM-title.md` files
- [ ] **User test:** Run for a day with events across multiple accounts, verify file output

### Milestone 3: Cross-Service Research
**Goal:** For each meeting, pull context from Gmail, Calendar history, and Google Drive.

- [ ] For each attendee, search Gmail for recent threads
- [ ] Search Drive for documents mentioning attendees or meeting topic
- [ ] Pull calendar history (past meetings with same attendees)
- [ ] Add research results to report files
- [ ] **User test:** Review reports, confirm useful context is being pulled

### Milestone 4: Great Meeting Prep Docs
**Goal:** Learn what the user actually wants in prep docs. Iterate on format, content, emphasis.

- [ ] Work through example reports one by one with user
- [ ] Record every preference to memory.txt
- [ ] Refine report template based on accumulated feedback
- [ ] Build rich context (recent email threads, shared docs, past meeting notes)
- [ ] **User test:** User reviews reports and provides feedback, Carlton improves

## Safety Guardrails

Carlton is **read-only**. The following must never happen:
- No `sendMessage`, `sendDraft`, `createDraft`, `updateDraft`, `deleteDraft` (Gmail)
- No `createEvent`, `updateEvent`, `deleteEvent` (Calendar)
- No `upload`, `delete`, `mkdir`, `move`, `rename`, `share`, `unshare` (Drive)

These constraints are:
1. Documented in CLAUDE.md
2. Not called anywhere in Carlton's source code
3. Tested (import checks in test suite)

---

## Appendix: Original User Direction (Verbatim)

> I want you to make a small minimal command line tool for helping me prepare for meetings. The tool will be called Carlton. He's preppy. The job of Carlton is to look at my calendars for a given day (by default tomorrow, but I want to be able to specify the date) and fetch all my meetings for that day and then for each meeting to do some research in my gmail, calendar, and docs on the attendees and create a meeting briefing doc the way I need for each meeting.
>
> The main complexity comes from:
> (1) I have many different calendars and many different email inboxes that need to be checked, but they're all Gmail and Google calendar.
> (2) it will take time to learn how to research people and find the type of information I'm looking for, and be able to prepare the meeting prep notes just the way that I want. I'm also learning how to use claude best for this and so it'll be a two way learning process.
>
> I want this to be a minimal, clear code base that I can trust and inspect to do an important job for me, and be exposed to my most sensitive data.
>
> I want you to use gmcli for Gmail, and gccli and gdcli for calendar and drive. Only use those libraries to interact with Gmail, Gdrive and Gcal. If you need to adjust them, fork our own versions and modify to suit our needs. Find links to those here: https://github.com/badlogic/pi-skills/tree/main
>
> We already do this on a similar project with just email with npm.com/@smcllns/gmail, so lets use a similar bunx shorthand for calling gmail, drive and cal for this CLI.
>
> This app is read-only. It does not require sending emails, composing drafts, creating or editing calendar invites, or deleting anything. It does smart retrieval and summarization, and can pick up follow up questions/comments from the user on how to improve/extend certain meeting summaries.
>
> We should use oauth scopes for readonly, or at least have hard coded preventions and clear documentation/hooks to clarify for all agents that this app does not require sending emails, composing drafts, creating or editing calendar invites, or deleting anything.
>
> I will get Google Cloud oauth key, and I want to login once per account and you use that same Google auth across all three libraries. Give me a prompt I can give to ChatGPT or Claude to walk me through setting up the oauth tokens for this.
>
> Have it run in a folder structure on my computer like this
>
> carlton/
> -.git
> -src/ (All the src files and credentials you need to run this)
> reports/
> [YYYY-MM-DD]/
> -[HH-MM-meeting-title].md
> memory.txt
>
> Every you time you complete a report, append to memory.txt:
> - All feedback the user gave you about what they wanted differently
> - Issues that took many attempts to solve and what the final solution was
> - Things you learned in this report that will help a future agent starting fresh
>
> Every time a new agent starts up, make sure memory text is injected into their prompt (the easiest way is like to use @ syntax to include the whole file @path/to/memory.txt in the CLAUDE.md
>
> Then I want you to build this step by step. Mostly work through it on your own and test it works, but then I want to test out the flow and you show me how to run at it each milestone (and let's confirm together it works the way I expect):
>
> Milestone 1: Read one of my calendars (get all the auth setup etc and prove it works)
>
> Milestone 2: Read all my calendars correctly and dedupe if needed (output empty md files in a folder with the right date)
>
> Milestone 3: Research my events in a given day (in a basic way) by pulling in context from gmail, calendar and docs (prove we have all these connected and working)
>
> Milestone 4: Get good at building great meeting prep docs - output exactly the format I want, pull in the key info I'm looking for, emphasize the right parts. Learn my style and needs (have built up good memory from many attempts). The best way to do this is to work through lots of example meeting reports together, one by one, and LLM record to memory all the things I want and tend to prefer. This means the workflow becomes
>
> Use Typescript, Bun, TDD, and bunx (preferred) or uvx (not pip). Keep the code simple and easy to reason about while developing.
>
> First order of business is probably translate this messy stream of direction into a more structured instruction for LLMs to be able to research and build a plan. Include this verbatim prompt for posterity in the plan file appendix, interesting to keep the original source and compare over time/catch drift.
