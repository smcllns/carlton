# Carlton — Original Direction & Progress

Snapshot of the project README as of 2026-02-07, capturing the original vision, milestones, and current status.

---

## What Carlton Is

Read-only meeting prep CLI. Pulls calendar events across multiple Google accounts, researches attendees via Gmail/Calendar/Drive, and generates briefing docs. Delivers briefings by email and listens for replies.

## Milestones

### Milestone 1: Read One Calendar ✅

Prove auth works end-to-end. Fetch events from one calendar account for a given date.

- ✅ Project structure (Bun + TS + deps)
- ✅ Import gccli CalendarService as library
- ✅ CLI: `bun carlton setup` shows auth status
- ✅ CLI: `bun carlton auth` shows setup instructions
- ✅ **User test:** Run `bun carlton setup`, then `bun carlton 2026-02-09` with configured accounts
- ✅ Confirm events are fetched and printed

### Milestone 2: All Calendars + File Output ✅

Fetch events from ALL calendars across ALL accounts. Deduplicate. Output `.md` files.

- ✅ Iterate all calendars per account (not just `primary`)
- ✅ Deduplicate events appearing in multiple calendars
- ✅ Create `reports/YYYY-MM-DD/HH-MM-title.md` files
- ⬜ **User test:** Run for a day with events across multiple accounts, verify file output

### Milestone 2.5: PROMPT.md Config, Email Delivery, Reply Loop ✅

Personalize via PROMPT.md, deliver briefings by email, respond to reply threads.

- ✅ PROMPT.md restructured into parseable sections (Accounts, Delivery, Briefing Format, Research Instructions)
- ✅ `src/prompt.ts` parser with tests
- ✅ Email delivery via Resend (`bun carlton send`)
- ✅ `src/email.ts` isolated from Google services (safety-tested)
- ✅ Reply polling loop (`bun carlton serve`)
- ✅ **User test:** Send a briefing, reply to it, verify Carlton detects the reply

### Milestone 3: Cross-Service Research ⬜

For each meeting, pull context from Gmail, Calendar history, and Google Drive.

- ⬜ For each attendee, search Gmail for recent threads
- ⬜ Search Drive for documents mentioning attendees or meeting topic
- ⬜ Pull calendar history (past meetings with same attendees)
- ⬜ Add research results to report files
- ⬜ **User test:** Review reports, confirm useful context is being pulled

### Milestone 4: Great Meeting Prep Docs ⬜

Learn what the user actually wants in prep docs. Iterate on format, content, emphasis.

- ⬜ Work through example reports one by one with user
- ⬜ Record every preference to memory.txt
- ⬜ Refine report template based on accumulated feedback
- ⬜ Build rich context (recent email threads, shared docs, past meeting notes)
- ⬜ **User test:** User reviews reports and provides feedback, Carlton improves

---

## Core Principles

- **Read-only on user data.** Carlton never sends emails from the user's Gmail, creates drafts, edits calendar events, or deletes anything.
- **Minimal and inspectable.** The user trusts this tool with sensitive data. Code must be simple, clear, and easy to audit.
- **Multi-account.** The user has many Gmail/Calendar accounts. Carlton checks all of them.
- **Learning system.** Each session appends to `memory.txt` what worked, what didn't, and what the user prefers.

## Security Model

- Google services are read-only — enforced by code, safety tests, and architecture
- Email delivery uses Resend (separate API), not the user's Gmail
- `src/email.ts` is architecturally isolated from Google — cannot access Gmail/Calendar/Drive credentials
- Data flow: Google (read) → Carlton (process) → Resend (send to user)

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
