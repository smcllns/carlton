# Reply Loop Architecture

## How it works

`bun carlton serve` polls Gmail every 30s for replies to Carlton briefing emails. When a reply arrives:

1. **Record** — extracts full MIME body, saves `reports/<date>/responses/NN-reply.md`, appends to `thread.md`
2. **Lock** — writes `.processing` lock file to prevent double-spawns
3. **Spawn** — `Bun.spawn` launches `claude -p --model sonnet --allowedTools "Read(reports/**),Write(reports/**),Bash(bun carlton respond *)"` with the prompt piped via stdin. Output logged to `.claude-reply.log`.

The spawned Claude has exactly 2 steps:
1. Write response to `reports/<date>/responses/NN-response.md`
2. Run `bun carlton respond <date> <NN>`

`carlton respond` is atomic — it does 3 things in sequence, and if the send fails, nothing else happens (lock stays for retry on next stale lock cleanup):
1. Send reply email via Resend (threaded via `In-Reply-To`)
2. Append response to `thread.md`
3. Remove `.processing` lock file

`CARLTON_DELIVERY_EMAIL` env var overrides the delivery address from PROMPT.md (used by E2E tests with Resend sandbox).

## History (2026-02-08)

**Before:** Agent had 4 steps (write file → call `reply-to <subject> <file> <date>` → update memory.txt → remove lock). Agent frequently stopped after step 1, leaving reply unsent and lock stuck. Spawn was via tmux (required tmux session). NEW markers on thread.md replies tracked unprocessed state redundantly with file numbering.

**After:** Agent has 2 steps (write file → call `respond <date> <NN>`). No tmux. No NEW markers. No memory.txt updates from reply agents. Number-based interface means the agent doesn't type the full file path twice.

## Concurrency

- Lock file (`.processing`) prevents double-spawns per date
- Multiple replies arriving while Claude is running get batched — the running agent sees all replies in thread.md
- `hasUnprocessedReplies()` compares max reply number vs max response number
- Stale locks (>10 min) are cleaned on each poll cycle

## Known limitation

The spawned Claude sometimes reasons its way out of calling `carlton respond` (e.g., anticipating Resend sandbox errors). Current mitigation is a prompt override in `src/reply.ts`. See CLAUDE.md backlog for longer-term fix ideas.

## Future consideration

Thread state (thread.md, lock files, file-counting state machine) could be replaced by a SQLite db. See CLAUDE.md backlog.
