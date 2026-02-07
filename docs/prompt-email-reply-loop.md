# Notes: PROMPT.md Config, Email Delivery, Reply Loop

## What was built

Carlton now has a full email-based interaction loop:

1. **PROMPT.md as structured config** — `src/prompt.ts` parses PROMPT.md into sections (System, Accounts, Daily Briefing Delivery, Briefing Format, Research Instructions).

2. **Email delivery via Resend** — `src/email.ts` sends briefings and threaded replies. Architecturally isolated from Google services (enforced by safety tests).

3. **Reply loop** — `bun carlton serve` (or just `./carlton`) polls Gmail every 30s for replies to Carlton briefing emails. When a reply is found, Carlton spawns an interactive Claude session that can research, update reports, send a reply, and log learnings.

4. **Standalone binary** — `bun run build` compiles a single 83MB ARM64 binary. Double-click or `./carlton` to start. Sends tomorrow's briefing, then polls for replies.

5. **Structured data** — User replies and Carlton's responses stored as numbered pairs in `reports/<date>/responses/`. Git commits before every email send for debuggable history.

## Architecture

```
User replies to email
  → Carlton (polling Gmail every 30s) detects reply
  → Saves reply to reports/<date>/responses/NN-reply.md
  → Writes context to .carlton-reply.md
  → Spawns `claude` interactively in Carlton project dir
  → Claude reads context, reports, uses gmcli/gccli/gdcli
  → Claude writes response to reports/<date>/responses/NN-response.md
  → Claude runs `bun carlton reply-to <subject> <response-file>`
  → reply-to does git commit, then sends via Resend
  → Claude logs learnings to reports/memory.txt
  → Carlton resumes polling
```

## Key Decisions

- **Resend vs Gmail for sending**: Google services strictly read-only. Email delivery uses separate API (Resend) with own API key. Even rogue agent can't send as the user.

- **email.ts ↔ google.ts boundary**: Must never import each other. Tested in `email.test.ts` and `safety.test.ts`.

- **Interactive Claude, not headless**: Spawned Claude runs interactively (no `-p` flag) so user can approve permissions, which save to `settings.json`. Pre-configured permissions in `.claude/settings.json` mean subsequent runs need no approval.

- **Git snapshots**: Commit before every email send. Between the commit history and the `responses/` folder, there's full auditability of what was sent and when.

- **Compiled binary path resolution**: `import.meta.dir` is virtual (`/$bunfs/`) in compiled mode. `getProjectRoot()` in config.ts uses `process.execPath` for compiled, `import.meta.dir` for dev.

- **Processed message IDs persisted**: `.carlton-processed-ids` file prevents re-processing old replies on restart.

## Gotchas

- gmcli uses `searchThreads()` not `searchMessages()`. Returns threads with embedded messages.
- gmcli `getThread()` returns `GmailThread | DownloadedAttachment[]` — check it's not an array.
- Message body is base64url encoded in `payload.parts[].body.data`. Need to walk MIME tree for multipart messages.
- Resend sandbox only sends to the account owner's email. Custom domain needed for other recipients.
- PROMPT.md section heading was renamed from "Delivery" to "Daily Briefing Delivery" by user — parser accepts both.

## Files

### Created
- `src/prompt.ts` — PROMPT.md parser
- `src/prompt.test.ts` — parser tests
- `src/email.ts` — Resend wrapper
- `src/email.test.ts` — isolation boundary tests
- `.env.example` — API key placeholder
- `.claude/settings.json` — pre-configured permissions for spawned Claude
- `docs/original-direction.md` — milestone tracking + original user brief

### Modified
- `PROMPT.md` — restructured into parseable sections
- `src/index.ts` — prepBriefing(), send/serve/reply-to commands, Claude spawning, git snapshots
- `src/config.ts` — getProjectRoot() for compiled binary support
- `src/safety.test.ts` — email↔google boundary test
- `.gitignore` — .env, /carlton binary, .carlton-reply.md, .carlton-processed-ids
- `README.md` — security model, new commands, folder structure, milestone 2.5
- `CLAUDE.md` — key files, security architecture section
- `package.json` — build script, resend + marked deps
