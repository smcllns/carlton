# Carlton Code Review — Simplifications & Cleanup

**Date:** 2026-02-07  
**Scope:** Read-only review for dead code, function complexity, redundancy, and documentation accuracy.  
**Status:** Complete findings below

---

## 1. Dead Code & Unused Imports

### src/index.ts

**Line 31** — Unused imports:
```typescript
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, unlinkSync } from "fs";
```
- `mkdirSync` imported but never used (directory creation happens in `reply.ts`, `research.ts`, `curator.ts`)
- `unlinkSync` only used once in `--test` flag path (line 625) — could be eliminated by removing `--test` and using separate `reset-sent` command

**Action:** Remove `mkdirSync` from imports. Move `unlinkSync` to conditional import or separate utility.

---

### src/report.ts

**Lines 5-6** — Inconsistent module imports:
```typescript
import * as fs from "fs";
import * as path from "path";
```

Rest of codebase uses:
```typescript
import { mkdirSync, writeFileSync, ... } from "fs";
import { join } from "path";
```

This is the only file using `* as` imports for these common modules.

**Action:** Match the codebase convention.

---

### src/prompt.test.ts

**Line 5** — Unused import:
```typescript
import * as os from "os";
```

Used only in `path.join(os.tmpdir(), ...)` (line 8) but `os.tmpdir()` is only called once. Direct import of `tmpdir` would be cleaner.

**Action:** Change to `import { tmpdir } from "os"` and use `tmpdir()` directly.

---

## 2. Functions Doing Too Many Things

### src/index.ts

**Line 273-332** — `cmdSend(date: string)` (60 lines)

Does: Check auth → prep briefing → check for already-sent → branch on TMUX env var → conditional research/curator spawn → polling with timeout

**Problem:** Conflates command logic with environment detection. TMUX check determines entire behavior (research + curator vs. basic send). This should be explicit.

**Why simplify:** 
- Makes testing harder (requires mocking `process.env.TMUX`)
- Difficult to debug when behavior changes based on environment
- Should be: `bun carlton send` does one thing; curator runs separately

**Action:** Remove TMUX check. `send` always does basic prep + send. Curator runs separately or is called explicitly.

---

**Line 445-538** — `cmdServe()` (94 lines)

Does: Check TMUX → load config → seed processed IDs → poll loop with searchThreads → filter drafts/from-user → dedupe → spawn Claude → persist IDs

**Problem:** Everything in one function. Polling, filtering, reply handling, persistence all interleaved.

**Action:** Extract:
- `seedProcessedMessages()` 
- `filterNewMessages(messages, processedIds)`
- Core poll loop stays in `cmdServe` but calls extracted helpers

---

### src/reply.ts

**Line 10-26** — `buildThreadHistory(responsesDir, currentNum)` (17 lines)

Does: Read directory → filter files → parse indices → build sparse array → construct markdown

**Problem:** Sparse array with fallback checks is harder to follow than necessary:
```typescript
if (!exchanges[idx]) exchanges[idx] = { reply: "", response: "" };
exchanges[idx][match[2] as "reply" | "response"] = content;
```

**Why it works but is complex:** Relies on array index math to pair up reply/response files by number.

**Action:** Simplify by building a Map first:
```typescript
const exchanges = new Map<number, { reply: string; response: string }>();
// Then populate
```
Then convert to sorted array. Clearer intent.

---

## 3. Redundant Logic

### src/index.ts

**Lines 165-169** and **197-201** — Identical tool config

In `cmdCredentials`:
```typescript
const tools = [
  { cmd: "gccli", label: "Google Calendar" },
  { cmd: "gmcli", label: "Gmail" },
  { cmd: "gdcli", label: "Google Drive" },
];
```

In `cmdAccountsAdd`:
```typescript
const tools = [
  { cmd: "gccli", label: "Google Calendar" },
  { cmd: "gmcli", label: "Gmail" },
  { cmd: "gdcli", label: "Google Drive" },
];
```

Identical. Repeated in 2 places (out of necessity since no shared config).

**Action:** Extract to module-level constant:
```typescript
const TOOLS = [
  { cmd: "gccli", label: "Google Calendar" },
  { cmd: "gmcli", label: "Gmail" },
  { cmd: "gdcli", label: "Google Drive" },
];
```

---

### src/index.ts

**Line 356-362** — `randomTldr(date, events)` function

Called once (line 294 in `cmdSend`). Simple enough to inline.

```typescript
// Current
const tldr = `> *${randomTldr(date, events)}*\n\n`;

// Inline
const hex = createHash("sha256").update(`${date}-${Date.now()}`).digest("hex").slice(0, 6);
const count = events.length;
const times = events.map((e) => formatTimeShort(e.start)).filter(Boolean);
const range = times.length >= 2 ? `${times[0]}–${times[times.length - 1]}` : times[0] || "all day";
const tldr = `> *${count} meeting${count !== 1 ? "s" : ""} on deck for ${date}, ${range} — ref:${hex}*\n\n`;
```

**Action:** Inline the function body and remove it.

---

### src/index.ts

**Line 549-553** vs **Line 79-87 in report.ts**

Two time formatters:
- `formatTimeShort(iso)` — extracts HH:MM from ISO (returns "14:00")
- `formatTime(iso)` in report.ts — formats as "2:00 PM" (with Intl.DateTimeFormat)

Both work on ISO strings but produce different outputs. Not redundant (different purposes) but naming is confusing. Someone reading `cmdPrep` line 266 won't immediately know that `formatTimeShort` is different from `formatTime`.

**Action:** Rename to clarify intent:
- `formatTimeShort` → `extractISOTime` or `getHHMM`
- Keep `formatTime` (it's for display)

---

## 4. Complexity That Could Be Simpler

### src/index.ts

**Line 292** — TMUX environment detection for behavior branching

```typescript
if (!process.env.TMUX) {
  console.log("Not in tmux — sending basic briefing (no research/curator).\n");
  // ... send without research
} else {
  console.log("Running research on each meeting...\n");
  // ... research + curator
}
```

**Problem:** Single command (`send`) has two completely different code paths based on environment. Tests must mock this. Behavior is implicit.

**Better approach:**
- `bun carlton send` always does research + curator (or always basic depending on design)
- If sometimes you want basic send, add `bun carlton send --quick` flag
- Or separate command entirely

**Action:** Decide on intended behavior:
  - Option A: `send` always does full research+curator, requires running in a context where curator can spawn
  - Option B: `send --quick` for basic send, `send --full` for research+curator
  - Remove TMUX check; make it explicit

---

### src/index.ts

**Line 318-331** — Polling with generous timeout

```typescript
const deadline = Date.now() + 180_000;  // 3 minutes
const check = async () => {
  while (Date.now() < deadline) {
    if (existsSync(sentMarker)) {
      const messageId = readFileSync(sentMarker, "utf8").trim();
      console.log(`✅ Briefing sent! (${messageId})`);
      return;
    }
    await new Promise((r) => setTimeout(r, 5000));  // 5 second intervals
  }
  console.log("⚠️  Curator timed out — briefing may not have sent. Check tmux windows.");
};
await check();
```

**Problem:** 
- Defensive polling. Curator process is running but we poll for file existence.
- 180 second timeout is long. If curator crashes, we wait 3 minutes.
- Could wait for process exit instead of polling file

**Better:** Store curator process handle and wait for exit:
```typescript
const curator = Bun.spawn([...]);
const exitCode = await curator.exited;
if (exitCode !== 0) {
  console.error("Curator failed");
} else {
  const messageId = readFileSync(sentMarker, "utf8");
  console.log(`✅ Briefing sent! (${messageId})`);
}
```

**Action:** Refactor to wait on process exit instead of polling file.

---

### src/index.ts

**Line 619-628** — `--test` flag to clear sent marker

```typescript
if (command === "send") {
  const testMode = args.includes("--test");
  const dateArg = args.slice(1).find(a => a !== "--test");
  const date = dateArg && isValidDate(dateArg) ? dateArg : getTomorrow();
  if (testMode) {
    const sentMarker = join(getReportsDir(), date, ".briefing-sent");
    if (existsSync(sentMarker)) {
      unlinkSync(sentMarker);
      console.log(`Cleared sent marker for ${date}.`);
    }
  }
  await cmdSend(date);
}
```

**Problem:** `--test` is a hidden flag that clears sent marker to allow resending. Mixed with command logic.

**Better:** Separate `reset-sent` command:
```typescript
bun carlton reset-sent [date]
```

Or use `--force` flag explicitly documented in help.

**Action:** Make flag explicit and documented, or use separate command.

---

### src/reply.ts

**Line 14-16** — Comment about caching:

```typescript
const files = readdirSync(responsesDir)
  .filter((f) => f.match(/^\d+-(reply|response)\.md$/) && !f.startsWith(currentPrefix))
  .sort();
```

No comment explaining file pattern. Should be:
```typescript
// Find all completed exchanges (pairs of reply + response files), excluding current
const files = readdirSync(responsesDir)
  .filter((f) => f.match(/^\d+-(reply|response)\.md$/) && !f.startsWith(currentPrefix))
  .sort();
```

**Action:** Add clarifying comment.

---

## 5. tmux Still Required?

Recent commit (95d5a32) moved curator to subprocess. But reply handlers haven't been migrated.

### src/index.ts

**Line 439-442** — `handleReply` spawns tmux window:
```typescript
Bun.spawn(
  ["tmux", "split-window", "-h", "-c", projectRoot, claudeCmd],
  { stdio: ["ignore", "ignore", "ignore"] }
);
```

Should use subprocess like curator:
```typescript
Bun.spawn(["claude", "-p", prompt, "--allowedTools", allowedTools], { ... });
```

### test/e2e.ts

**Lines 196-199, 253-255** — Still spawns tmux windows:
```typescript
Bun.spawn(
  ["tmux", "new-window", "-n", windowName, "-c", PROJECT_ROOT, claudeCmd],
  { stdio: ["ignore", "ignore", "ignore"] },
);
```

Should spawn Claude subprocess instead.

**Action:** 
1. Migrate reply handlers to subprocess spawn like curator
2. Update E2E test to match
3. Remove tmux requirement from `cmdServe` check (line 446-448)
4. Update documentation (README.md:42, CLAUDE.md)

---

## 6. Documentation Issues

### README.md

**Line 42** — Misleading comment:
```markdown
Both `send` and `serve` must run inside tmux (they spawn Claude agents as tmux panes).
```

Curator no longer spawns in tmux panes (commit 95d5a32). Only reply handlers do (which should change too per above).

**Action:** Update to "serve requires tmux because reply handlers spawn Claude in tmux windows. This will change when handlers migrate to subprocess."

---

**Line 160** — Incomplete milestone:
```markdown
- [ ] **User test:** Run for a day with events across multiple accounts, verify file output
```

Should be:
```markdown
- [x] **User test:** Confirmed working with multi-account calendars
```

**Action:** Mark complete (confirmed in memory.txt that multi-account works).

---

**Lines 182, 191** — Incomplete Milestone 3 & 4:
```markdown
- [ ] **User test:** Review research quality, tune research instructions in PROMPT.md
```

These are tracked in memory.txt. Should be marked complete or updated.

**Action:** Review memory.txt findings and update milestone status.

---

### CLAUDE.md

Missing commands in "Key files" section:
- `send-briefing [date]` — mentioned in index.ts but not documented
- `reply-to <subject> <file>` — mentioned in index.ts but not documented
- `reset` — mentioned but not fully documented

**Action:** Add to CLAUDE.md and/or add help text to index.ts.

---

## 7. Minor Improvements (Lower Priority)

### src/calendar.ts

**Line 88-104** — `dedupeEvents` uses Map then converts:
```typescript
const seen = new Map<string, CalendarEvent>();
for (const event of events) {
  const key = `${event.start}|${event.summary}`;
  if (!seen.has(key)) {
    seen.set(key, event);
  }
}
return Array.from(seen.values()).sort((a, b) => a.start.localeCompare(b.start));
```

This works fine. Slight inefficiency: convert to array just to sort. Could use:
```typescript
const deduped = Array.from(seen.values());
deduped.sort((a, b) => a.start.localeCompare(b.start));
return deduped;
```

But current code is clear and performance is fine for typical use.

**Action:** No change needed (working well).

---

### src/index.ts

**Line 51-53** — `isValidDate`:
```typescript
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}
```

Works fine. Defensive regex + parse. Could just rely on parse, but regex prevents false positives on weird inputs. No change needed.

---

## Summary of Recommended Changes

### Tier 1: Important (Simplify core logic)
1. Extract `TOOLS` constant (eliminates duplication)
2. Inline `randomTldr` function
3. Refactor `cmdSend` to remove TMUX branching (decide on behavior)
4. Refactor `cmdServe` to extract polling helpers
5. Migrate reply handlers to subprocess instead of tmux
6. Update E2E test to use subprocess

### Tier 2: Code Quality (Improve clarity)
1. Simplify `buildThreadHistory` using Map
2. Remove unused imports (`mkdirSync`, `os` in test)
3. Fix inconsistent module imports in report.ts
4. Rename time formatters for clarity
5. Refactor curator polling to wait on process exit
6. Add clarifying comment to `buildThreadHistory`

### Tier 3: Documentation (Update accuracy)
1. Update README.md on tmux requirement
2. Mark completed milestones
3. Add missing commands to CLAUDE.md help text
4. Remove or clarify `--test` flag

### Not Recommended
- `google.ts` — Already minimal and clean
- `email.ts` — Properly isolated, good design
- Safety tests — Well-written and effective
- Test coverage — Comprehensive

---

## Unresolved Questions

1. **TMUX requirement behavior:** Should `send` do research+curator automatically or require explicit flag? Impacts command interface.
2. **Curator timeout:** Is 180 seconds appropriate? Curator is now a subprocess so can monitor exit code instead.
3. **Memory.txt milestones:** Should Milestone 4 remain open or be split into smaller tracked items?

---

