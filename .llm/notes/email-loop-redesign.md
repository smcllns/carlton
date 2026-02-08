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

## Files Changed

- `src/email.ts` — `sendBriefing()` now takes `date`, returns `{resendId, messageId}`, sets `Message-ID` header. `briefingMessageId()` exported. `sendReply()` only sets threading headers when `inReplyTo` is non-empty.
- `src/reply.ts` — Removed `buildReplyContext()`, `buildThreadHistory()`. Added `maxReplyNumber()`, `maxResponseNumber()`, `hasUnprocessedReplies()`, `appendToThread()`, `removeNewMarkers()`, `buildReplyPrompt()`. `replyFilePaths()` no longer returns `contextFile`. `nextResponseNumber()` now returns maxReply + 1 (not count + 1).
- `src/index.ts` — Replaced `handleReply()` with `recordReply()` + `triggerProcessing()` + `spawnClaudeInTmux()`. `cmdSendBriefing()` creates thread.md. `cmdReplyTo()` takes optional date, reads `.briefing-sent` JSON, appends to thread.md, removes NEW markers. `cmdServe()` startup cleans stale locks and triggers for unprocessed dates.
- `src/curator.ts` — `--model haiku` → `--model sonnet`

## Tests

88 tests across 8 files:
- `test/reply.test.ts` — state detection (maxReplyNumber, maxResponseNumber, hasUnprocessedReplies), thread.md management (appendToThread, removeNewMarkers), buildReplyPrompt
- `test/serve.test.ts` — lock behavior, batching correctness, double-spawn prevention, stale lock detection
- `test/thread.test.ts` — append ordering, special characters, NEW marker lifecycle, concurrent appends
- `test/email.test.ts` — Message-ID format, .briefing-sent JSON contract
- `test/e2e.ts` — full loop: briefing → thread.md → reply → lock → Claude → batch → stale recovery

## Remaining

- E2E test needs to be run in tmux to verify Claude integration end-to-end
- Manual test: send real briefing, reply, verify threading in Gmail
