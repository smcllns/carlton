---
name: carlton
description: Daily meeting prep briefing. Fetches calendar events, researches via Gmail/Drive, sends briefing email. Usage: /carlton [send] [YYYY-MM-DD] [--test]
allowed-tools: Bash(skill/scripts/send-briefing.sh:*), Bash(bunx gmcli:*), Bash(bunx gccli:*), Bash(bunx gdcli:*)
---

# Carlton — Meeting Prep Briefing

## Invocation

| Command | Action |
|---|---|
| `/carlton` | Send briefing for tomorrow |
| `/carlton send 2026-02-11` | Send for specific date |
| `/carlton send --test` | Clear previous run, send fresh |
| `/carlton 2026-02-11` | List events only (no research/send) |

## Pipeline

### 1. Read PROMPT.md

Read `PROMPT.md` from the project root. Extract:
- **Accounts**: email addresses listed under `## Calendars to Include`
- **Delivery email**: `send to:` value under `## Daily Delivery`
- **Subject pattern**: `Subject line:` from `## Briefing Format` (replace `YYYY-MM-DD` with date)

Everything else in PROMPT.md (System, Research Instructions, Briefing Format, CLI Tools) is your direct instructions — follow them.

### 2. Parse Date

- If a YYYY-MM-DD date is provided, use it
- Otherwise, use tomorrow
- If `--test` flag: run `skill/scripts/send-briefing.sh reset <date>` to clear previous run

### 3. Check Already Sent

Run `skill/scripts/send-briefing.sh check <date>`. If already sent, print the date and stop.

### 4. Fetch Calendar Events

For each account from PROMPT.md:

```bash
bunx gccli <account> calendars
```

Then for each calendar (skip any that error — subscription calendars like birthdays/holidays will throw):

```bash
bunx gccli <account> events --calendarId "<calendar-id>" --from "<date>T00:00:00-08:00" --to "<next-day>T00:00:00-08:00"
```

Collect all events. Deduplicate by (start time + summary). Sort chronologically.

If no events, print "No meetings for <date>" and stop.

### 5. Research & Write Briefing

Follow the **Research Instructions** and **Briefing Format** sections from PROMPT.md to research each meeting and write the briefing.

Write the result to `reports/<date>/briefing.md` using the Write tool.

The briefing is ONLY the final markdown — no preamble, thinking, or explanation.

### 6. Send Email

```bash
skill/scripts/send-briefing.sh send <delivery-email> "<subject>" <date> reports/<date>/briefing.md
```

Print confirmation when done.

## Safety: Read-Only

Carlton is READ-ONLY on Google services. NEVER:
- Send, create, update, or delete emails (Gmail)
- Create, update, or delete calendar events (Calendar)
- Upload, delete, or share files (Drive)

The allowed-tools restrict you to read-only CLI commands (search, list, get, download).
