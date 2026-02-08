# Email Loop Redesign

## Implementation Instructions

**Step 1**: Create a branch `email-loop-redesign`, commit this plan file, push, and open a draft PR with the plan as the body. The sprite agent will pick up this PR and implement it autonomously.

**Step 2**: The sprite agent implements the changes described below, pushes commits to the branch, and runs the test plan at the bottom of this document to harden the loop before marking the PR ready for review.

---

## Context

Three problems with the current reply loop:
1. One Claude per reply — race conditions, no coordination, wasteful
2. Reply Claudes get thin context — told to "check report files" instead of having clear guidance
3. Email threading broken — `inReplyTo` always `""` in `cmdReplyTo()`

---

## How the Loop Works Today

```
cmdServe() polls Gmail every 30s
  │
  ├─ finds reply A → handleReply()
  │    ├─ write 01-reply.md + build context + spawn Claude #1
  │
  ├─ finds reply B → handleReply()       ← while Claude #1 still running
  │    └─ spawn Claude #2                ← race condition
  │
  └─ reply C → spawn Claude #3           ← three concurrent Claudes
```

**Problems:** N replies → N Claudes, no coordination. Thin context — Claude discovers files via tool calls. `inReplyTo` is `""` — threading broken. Record + process coupled in one function.

---

## How the Loop Works After

Two actors: a **dumb serve loop** (mechanical) and **one Claude** (all intelligence).

```
SERVE LOOP (polls every 30s):
  │
  ├─ Poll Gmail → for each new reply:
  │    write NN-reply.md + append to thread.md
  │
  └─ triggerProcessing(date):
       .processing lock exists? → skip (Claude already running)
       unprocessed replies? → write lock, spawn ONE Claude (Sonnet), done
       (fire and forget — next poll cycle handles the rest)

CLAUDE (one agent, all intelligence):
  │
  ├─ Gets full thread.md inlined in prompt (briefing + all exchanges + NEW replies)
  ├─ Triage: trivial ("thanks!") or substantive?
  │    Trivial → brief ack, skip context loading
  │    Substantive → reads whatever research/memory it needs
  ├─ Write response → NN-response.md
  ├─ Send email: bun carlton reply-to <subject> <file> <date>
  │    (this also appends response to thread.md, removes NEW markers)
  ├─ Update memory.txt
  └─ rm .processing lock
       └─ next poll cycle: if more replies arrived, spawns again
```

### Why this works

`triggerProcessing(date)` is dead simple — no async, no state tracking, no waiting:

```typescript
function triggerProcessing(date: string) {
  const responsesDir = join(getReportsDir(), date, "responses");
  const lockFile = join(responsesDir, ".processing");

  if (existsSync(lockFile)) return;                // Claude already running
  if (!hasUnprocessedReplies(responsesDir)) return; // nothing to do

  writeFileSync(lockFile, new Date().toISOString());
  spawnClaudeInTmux(date); // fire and forget
}
```

**Scenarios:**
- Reply arrives, nothing running → write lock, spawn Claude
- Reply arrives, Claude running → skip (lock exists). Claude finishes → removes lock. Next poll: unprocessed + no lock → spawn again
- Three replies arrive at once → one Claude addresses all three
- Claude crashes → lock stays. Stale check (mtime > 10 min) on next poll removes it → respawn

**No in-process state, no async waiting, no polling loops.** The 30s Gmail poll IS the retry mechanism.

---

## thread.md — canonical conversation record

One file per date, chronological, always up to date. Two purposes:
1. **Agent context**: inlined into Claude's prompt — full conversation with zero tool calls
2. **Human debugging**: read one file, see exactly what happened

```markdown
# Carlton Thread — 2026-02-09

## Briefing Sent (2026-02-08 05:00 GMT)
{briefing.md content}

---

## Reply #1 (2026-02-08 10:15 from sam@test.com)
{reply content}

## Response to Reply #1
{response content}

---

## NEW Reply #2 (2026-02-08 14:30 from sam@test.com)
{reply content}
```

**Who appends what:**
- `cmdSendBriefing()` → creates thread.md with briefing content
- `recordReply()` → appends `## NEW Reply #N` with reply body
- `cmdReplyTo()` → appends `## Response` after successful send, removes NEW markers

**State detection uses file numbers** (not thread.md parsing):
- `max(NN-reply.md) > max(NN-response.md)` → unprocessed replies exist
- This is the serve loop's state machine. thread.md is the conversation record. Different jobs.

Individual reply/response files still written for atomicity — if thread.md corrupts, rebuild from them.

---

## File Structure

```
reports/{date}/
  thread.md            # Full conversation (source of truth for context)
  briefing.md          # The briefing itself
  research/            # Per-meeting research
  responses/
    01-reply.md        # User reply #1 (atomic record)
    02-reply.md        # User reply #2
    02-response.md     # Carlton response (addressed replies 1-2)
    .processing        # Lock file (exists while Claude running)
```

---

## Changes

### 0. Verify Resend Message-ID support (do first)

Send a test email with custom `Message-ID` header via Resend. If it works, proceed. If Resend overrides it, use `References` header with computed value instead.

### 1. Fix email threading — `src/email.ts`, `src/index.ts`

- `sendBriefing()`: Set `Message-ID` header: `<carlton-{date}@carlton.local>`
- `.briefing-sent`: JSON `{"resendId":"...","messageId":"..."}`
- `cmdReplyTo(subject, bodyFile, date)`: Read `.briefing-sent`, pass messageId to `sendReply()`
- `cmdReplyTo` also appends response to thread.md + removes NEW markers
- CLI: `bun carlton reply-to <subject> <file> <date>`

### 2. Upgrade curator model — `src/curator.ts`

`--model haiku` → `--model sonnet` (line 121)

### 3. reply.ts — `src/reply.ts`

Remove: `buildReplyContext()`, `buildThreadHistory()`

Add:
- `maxReplyNumber(dir)`, `maxResponseNumber(dir)`, `hasUnprocessedReplies(dir)`
- `buildReplyPrompt(date)` — reads thread.md, inlines into prompt template
- `appendToThread(threadFile, section, content)` — appends section to thread.md
- `removeNewMarkers(threadFile)` — removes NEW prefix from addressed replies

Keep: `writeReplyFile()`, `nextResponseNumber()`, `replyFilePaths()`

### 4. Redesign serve loop — `src/index.ts`

- `recordReply(account, threadId, msg)` — writes NN-reply.md + appends to thread.md
- `triggerProcessing(date)` — check lock, check unprocessed, write lock, spawn (fire and forget)
- `spawnClaudeInTmux(date)` — spawns one Sonnet with prompt from `buildReplyPrompt()`
- On startup: clean stale locks (mtime > 10 min), trigger for any dates with unprocessed replies
- `cmdSendBriefing()` now creates thread.md after sending

### 5. Reply Claude prompt template

```
You are Carlton's reply handler for the {date} briefing.

## Thread

{thread.md content — briefing, all prior exchanges, NEW replies}

## Available Context

If you need deeper context:
- reports/{date}/research/ — {list of files with meeting names}
- reports/memory.txt — user preferences
- Google tools: bunx gmcli, bunx gccli, bunx gdcli (read-only, use --help)

Read what you need. You may not need any of it.

## Respond

Respond to all replies marked NEW above.
1. Write response: reports/{date}/responses/{NN}-response.md
   (NN = highest reply# being addressed)
2. Send: bun carlton reply-to "{subject}" {response-file} {date}
3. Update reports/memory.txt with user preferences if any
4. rm reports/{date}/responses/.processing
```

### 6. Write and pass all tests below, then mark PR ready for review

---

## Task Sequence

- [x] 0. Verify Resend Message-ID support — test first
- [x] 1. Fix threading (`email.ts`, `index.ts`) — standalone
- [x] 2. Upgrade curator model (`curator.ts`) — one line
- [x] 3. Simplify `reply.ts` + thread.md helpers — standalone
- [x] 4. Redesign serve loop (`index.ts`) — depends on 1, 3
- [x] 5. Write and pass ALL tests below — depends on 4 (89 tests passing)
- [ ] 6. Manual Gmail threading test — verify response threads correctly
- [ ] 7. Mark PR ready for review

---

## Test Plan — Hardening the Loop

Write these tests and confirm they all pass before marking the PR ready. The goal is to prove the loop is not racy, not brittle, and handles every edge case.

### Unit Tests (`test/reply.test.ts`)

**State detection:**
- `maxReplyNumber()` — empty dir → 0, one reply → 1, gaps in numbering (01, 03) → 3
- `maxResponseNumber()` — empty dir → 0, one response → 1, gaps → correct max
- `hasUnprocessedReplies()` — no files → false, replies only → true, all replied → false, new reply after last response → true

**thread.md management:**
- `appendToThread()` — appends to existing file, creates file if missing
- `removeNewMarkers()` — `## NEW Reply #2` becomes `## Reply #2`, leaves non-NEW sections untouched, handles multiple NEW markers in one pass

**Prompt building:**
- `buildReplyPrompt()` — includes thread.md content, lists research files, includes response instructions
- `buildReplyPrompt()` with missing thread.md — throws (don't silently fail)

### Lock + Concurrency Tests (`test/serve.test.ts`)

**Lock file behavior:**
- `triggerProcessing()` with no lock + unprocessed replies → creates lock file, returns
- `triggerProcessing()` with lock present → returns immediately (no spawn)
- `triggerProcessing()` with no unprocessed replies → returns immediately (no lock, no spawn)
- `triggerProcessing()` with stale lock (mtime > 10 min) → deletes lock, creates new lock, spawns

**No double-spawn race:**
- Call `triggerProcessing(date)` twice in rapid succession — assert lock file created exactly once, spawn called exactly once
- Simulate: write 3 reply files, call `triggerProcessing()` — assert only one Claude spawned

**Batching correctness:**
- Write replies 01, 02, 03. `triggerProcessing()` spawns. Simulate Claude writing `03-response.md` and removing lock. Now `hasUnprocessedReplies()` → false. Then write reply 04. `triggerProcessing()` → spawns again. Assert two total spawns, not three.

### thread.md Integrity Tests (`test/thread.test.ts`)

**Append ordering:**
- Create thread with briefing. Append reply #1. Append response. Append reply #2. Read file — sections appear in correct chronological order.
- Append reply with special characters (quotes, backticks, markdown headers in email body) — file doesn't corrupt

**NEW marker lifecycle:**
- Append NEW Reply #1 → file contains `## NEW Reply #1`
- Call removeNewMarkers → file contains `## Reply #1` (NEW removed)
- Append NEW Reply #2, NEW Reply #3 → both marked NEW
- Call removeNewMarkers → both NEW markers removed, content preserved

**Concurrent appends (simulate):**
- Two rapid `appendToThread()` calls — both sections appear in file, neither lost

### Email Threading Tests (`test/email.test.ts`)

- `sendBriefing()` sets `Message-ID` header matching `<carlton-{date}@carlton.local>`
- `.briefing-sent` contains valid JSON with `resendId` and `messageId`
- `cmdReplyTo()` reads `.briefing-sent` and passes messageId to `sendReply()` as `inReplyTo`
- `sendReply()` sets `In-Reply-To` and `References` headers from the messageId

### E2E Integration Test (`test/e2e.ts`)

Update the existing E2E test to exercise the full new loop:

1. **Create report + send briefing** — verify thread.md created with briefing content, `.briefing-sent` contains JSON
2. **Double-send guard** — second send is blocked
3. **Simulate reply #1** — write reply file via `recordReply()`, verify thread.md has `## NEW Reply #1`, verify `hasUnprocessedReplies()` → true
4. **Trigger processing** — call `triggerProcessing()`, verify lock created, Claude spawned in tmux
5. **Wait for response #1** — poll for `01-response.md`, verify thread.md updated (response appended, NEW marker removed)
6. **Simulate replies #2 and #3 while NOT processing** — write both, verify thread.md has two NEW entries, verify only one Claude spawns
7. **Wait for response** — poll for `03-response.md` (numbered by highest reply), verify both NEW markers removed from thread.md
8. **Lock prevents concurrent spawn** — write reply #4, manually create `.processing` lock, call `triggerProcessing()` → verify NO spawn. Remove lock, call again → verify spawn.
9. **Stale lock recovery** — create `.processing` with mtime 15 minutes ago, call stale lock cleanup, verify lock removed, verify `triggerProcessing()` spawns
10. **Cleanup** — kill tmux windows, remove test data

### Checklist Before Marking PR Ready

- [x] All unit tests pass (`bun test`) — 89 tests passing
- [x] E2E test passes in tmux (`bun test/e2e.ts`) — 10/10 steps
- [x] Safety tests still pass (`bun test test/safety.test.ts`)
- [ ] Manual test: send briefing, reply in Gmail, verify response threads correctly
- [x] No new TypeScript errors (pre-existing .ts extension warnings only)
