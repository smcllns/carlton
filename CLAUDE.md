# Carlton - Meeting Prep Assistant

## What is this?
Carlton fetches calendar events for a given day (default: tomorrow) across multiple Google accounts, researches attendees via Gmail and Google Drive, and generates a daily briefing email.

## Architecture
- **TypeScript + Bun** — Simple, fast, easy to reason about
- **@mariozechner/gccli** — Google Calendar access (library import)
- **@mariozechner/gmcli** — Gmail access (library import)
- **@mariozechner/gdcli** — Google Drive access (library import)
- Auth is managed per-tool in `~/.gccli/`, `~/.gmcli/`, `~/.gdcli/`

## Key files
- `src/index.ts` — CLI entry point and all commands
- `src/google.ts` — Wrappers for gccli, gmcli, gdcli
- `src/calendar.ts` — Multi-account event fetching + dedup
- `src/briefing.ts` — Single Claude agent: researches meetings + produces briefing
- `src/prompt.ts` — PROMPT.md parser (accounts, delivery, freeform sections)
- `src/email.ts` — Resend email delivery (⚠️ isolated from Google — see Security below)
- `src/config.ts` — Path helpers (project root, reports dir)
- `PROMPT.md` — User config (accounts, delivery, briefing format, research instructions)
- `credentials/` — Your OAuth JSON goes here (gitignored)
- `skill/` — Zero-code Claude Code skill variant (see `skill/README.md`)

## CRITICAL: Read-Only Safety

**Carlton is READ-ONLY. It MUST NEVER:**
- Send emails, create drafts, update drafts, or delete drafts (Gmail)
- Create, update, or delete calendar events (Calendar)
- Upload, delete, move, rename, share, or unshare files (Drive)

This is enforced by:
1. `src/safety.test.ts` - scans all source files for forbidden method calls
2. This documentation - all agents must respect this constraint
3. Code review - never add write methods to any source file

If you need to add functionality, it must be **read-only** (search, list, get, download).

## ⚠️ Security Architecture

Carlton separates Google data access from email delivery:

- **Google services (google.ts)** — read-only access to Gmail, Calendar, Drive via OAuth tokens in `~/.gmcli/`, `~/.gccli/`, `~/.gdcli/`
- **Email delivery (email.ts)** — sends briefings via Resend using `RESEND_API_KEY` from `.env`
- **These two must never cross.** `email.ts` MUST NOT import `google.ts` or any `@mariozechner/*` library. Safety tests enforce this.
- **PROMPT.md is the user's config** — read it, don't modify it
- **Data flow:** Google (read) → Carlton (process) → Resend (send to user)

