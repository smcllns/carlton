# Carlton - Meeting Prep Assistant

## What is this?
Carlton fetches calendar events for a given day (default: tomorrow) across multiple Google accounts, researches attendees via Gmail and Google Drive, and generates meeting prep documents.

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
- `src/report.ts` — Report generation and file output
- `src/config.ts` — Config management
- `credentials/` — Your OAuth JSON goes here (gitignored)

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

## Memory

Read `reports/memory.txt` before starting any work. It contains accumulated learnings about user preferences, meeting prep style, and technical gotchas.

A stop hook will remind you to update memory.txt before finishing. Format:

```
[YYYY-MM-DD] category: one-line learning
```

Categories:
- **preference** — How the user wants meeting prep (format, tone, emphasis)
- **process** — Workflow improvements, what to do differently
- **gotcha** — API quirks, auth issues, library behavior

@reports/memory.txt
