# Email Loop Redesign

## What Changed

Replaced the one-Claude-per-reply design with a lock-based batch processing model.

### Before
- `handleReply()` coupled recording + processing — each reply spawned a separate Claude
- Reply Claudes got thin context (told to "check report files")
- Email threading broken (`inReplyTo` always `""`)
- N replies → N concurrent Claudes with no coordination

### After
- `recordReply()` just records: writes NN-reply.md + appends to thread.md
- `triggerProcessing()` checks lock, checks unprocessed, spawns ONE Claude (Sonnet)
- `thread.md` is the canonical conversation record, inlined into Claude's prompt
- `.processing` lock file prevents concurrent Claudes
- `cmdReplyTo()` now accepts date arg, reads `.briefing-sent` JSON for threading headers
- `sendBriefing()` sets `Message-ID: <carlton-{date}@carlton.local>`, returns `{resendId, messageId}`
- `.briefing-sent` is now JSON instead of plain text
- Curator model upgraded from haiku to sonnet

## Key Design Decisions

1. **State detection via file numbers, not thread.md parsing**: `max(NN-reply.md) > max(NN-response.md)` = unprocessed. Simple, reliable, no regex.
2. **thread.md for context, files for state**: thread.md is the conversation record (inlined into prompts). Individual files are the state machine.
3. **NEW markers**: `appendToThread()` writes `## NEW Reply #N`, `removeNewMarkers()` strips the NEW prefix after response sent. Claude sees what's new at a glance.
4. **Fire-and-forget spawning**: `triggerProcessing()` is synchronous — check lock, check state, write lock, spawn, return. The 30s Gmail poll IS the retry mechanism.
5. **Stale lock cleanup**: `cleanStaleLocks()` removes locks older than 10 minutes (Claude crashed). Runs on startup and before each trigger.
6. **CLI guard**: `index.ts` wraps CLI dispatch in `if (isCLI)` so importing `triggerProcessing` in tests doesn't execute the CLI.

## Files Changed

- `src/email.ts` — `sendBriefing()` now takes `date`, returns `{resendId, messageId}`, sets `Message-ID` header. `briefingMessageId()` exported. `sendReply()` only sets threading headers when `inReplyTo` is non-empty.
- `src/reply.ts` — Removed `buildReplyContext()`, `buildThreadHistory()`. Added `maxReplyNumber()`, `maxResponseNumber()`, `hasUnprocessedReplies()`, `appendToThread()` (with mkdirSync for safety), `removeNewMarkers()`, `buildReplyPrompt()`. `replyFilePaths()` no longer returns `contextFile`. Renamed `nextResponseNumber()` → `nextReplyNumber()` (was misnamed — it numbers replies, not responses).
- `src/index.ts` — Replaced `handleReply()` with `recordReply()` + `triggerProcessing()` + `spawnClaudeInTmux()`. `triggerProcessing()` accepts `opts.reportsDir` + `opts.spawnFn` for testability, cleans up lock on spawn error. `cmdSendBriefing()` creates thread.md. `cmdReplyTo()` takes optional date, reads `.briefing-sent` JSON (warns on old format), appends to thread.md, removes NEW markers. `cmdServe()` startup cleans stale locks and triggers for unprocessed dates.
- `src/curator.ts` — `--model haiku` → `--model sonnet`

## Tests

88 tests across 8 files:
- `test/reply.test.ts` — state detection, thread.md management (incl. parent dir creation), buildReplyPrompt
- `test/serve.test.ts` — calls real `triggerProcessing()` with mock spawn + temp dirs. Lock behavior, lock cleanup on error, double-spawn prevention, batch flow.
- `test/thread.test.ts` — append ordering, special characters, NEW marker lifecycle, concurrent appends
- `test/email.test.ts` — Message-ID format, .briefing-sent JSON contract
- `test/e2e.ts` — full loop with real Claude spawning in tmux

## Review Findings (fixed)

Both Haiku and Opus reviewed. Key fixes applied:
- `nextResponseNumber` renamed → `nextReplyNumber` (was actively misleading)
- `triggerProcessing` cleans up lock file if spawn throws
- `triggerProcessing` accepts `reportsDir` param so `serve.test.ts` tests real function
- `appendToThread` calls `mkdirSync(dirname(threadFile))` before write
- `cmdReplyTo` warns on old `.briefing-sent` format instead of silent `catch {}`
- E2E assertions tightened: thread.md state is asserted, not just logged
- E2E timing: waits for `.processing` lock removal before checking thread.md

## Threading Fix

The original design set `Message-ID: <carlton-{date}@carlton.local>` on outgoing briefings and referenced it via `In-Reply-To` on responses. But Resend overrides the Message-ID with its own, so Gmail couldn't match the `In-Reply-To` header.

**Fix:** `recordReply()` now extracts the `Message-Id` header from the user's Gmail reply (a real Gmail Message-ID) and saves it to `.last-reply-id` in the responses dir. `cmdReplyTo()` reads `.last-reply-id` for the `In-Reply-To` header instead of `.briefing-sent`.

**Other fixes found during manual testing:**
- `triggerProcessing()` crashed on pre-redesign dates (no `thread.md`). Added guard: skip dates without `thread.md`.
- `serve` startup logged `prompt.delivery.email` (PROMPT.md placeholder) instead of the `CARLTON_DELIVERY_EMAIL` override.

## Current Status

- Unit tests: 89/89 passing
- Safety tests: passing
- E2E test: **passed** — 10/10 steps
- Manual test: **in progress** — briefing sent for 2026-02-10, threading fix applied, needs Sam to reply and verify response threads correctly in Gmail
- Remaining: manual Gmail threading verification, then mark PR ready

## How to Continue

1. Clean up 2026-02-10 test data: `rm -rf reports/2026-02-10/responses reports/2026-02-10/.briefing-sent reports/2026-02-10/thread.md`
2. Send fresh briefing: `bun carlton send-briefing 2026-02-10`
3. Start serve: `tmux new -s carlton-test 'bun carlton serve'`
4. Reply to briefing in Gmail
5. Wait for serve to pick up reply and spawn Claude
6. Verify response arrives **in the same Gmail thread** as the briefing
7. When verified, mark PR ready: `gh pr ready 1`

## PR

- Branch: `email-loop-redesign`
- PR: https://github.com/smcllns/carlton/pull/1 (draft)
