# Final Code Review Recommendation

Verified all claims against source. Prioritized by impact and correctness risk.

---

## DO FIRST (bugs and correctness)

### 1. Remove the tmux gate in `cmdSend` (lines 292-302 of index.ts)

The `if (!process.env.TMUX)` branch sends a stripped-down briefing with no research and no curator. But curator already runs as a direct subprocess (`Bun.spawn` with `claude -p`), not a tmux window. So `send` works headlessly now — the tmux check is wrong and degrades output unnecessarily.

**Fix:** Remove the `if (!process.env.TMUX)` branch entirely. Always run research + curator.

### 2. Curator `spawnCurator` doesn't wait for exit (curator.ts line 122-128)

`spawnCurator` fires `Bun.spawn` and returns immediately. Back in `cmdSend` (index.ts lines 319-331), the code polls for `.briefing-sent` file existence every 5s with a 3-minute timeout. This is fragile — if curator crashes, we wait 3 minutes for nothing. The process handle is right there.

**Fix:** Return the `proc` from `spawnCurator`, `await proc.exited` in `cmdSend`, then check if `.briefing-sent` exists. If exit code != 0, fail immediately instead of polling.

### 3. `randomTldr` uses `Date.now()` making the ref hash non-deterministic (index.ts line 357)

The hash includes `Date.now()`, so the same date+events produce a different ref every time. If this is just a cosmetic reference ID, drop the hash entirely — it adds nothing. If determinism matters (e.g., dedup), remove `Date.now()` from the input.

**Fix:** Remove the hash. `"3 meetings on deck for 2026-02-10, 9:00-17:00"` is already unique per date+events.

---

## DO NEXT (dead code cleanup — one pass, 15 minutes)

### 4. Delete dead config.json system in config.ts

`loadConfig`, `saveConfig`, `CarltonConfig`, `CarltonAccount`, `CONFIG_FILE`, `DEFAULT_CONFIG` — all dead. Accounts come from upstream tools (`cal.listAccounts()`, `gmail.listAccounts()`), not from a Carlton config.json.

`calendar.ts` imports `loadConfig` but never calls it. `config.test.ts` tests `loadConfig` but it's testing dead code. The only live exports from `config.ts` are `getProjectRoot`, `getReportsDir`, `getMemoryFile`.

**Fix:** Remove dead code from `config.ts`. Remove `loadConfig` import from `calendar.ts`. Simplify `config.test.ts` to only test the live exports.

### 5. Delete dead imports and variables in curator.ts

- `mkdirSync`, `writeFileSync` — imported, never called
- `getReportsDir` — imported, never called
- `windowName` (line 116) — assigned, never used (tmux leftover)

**Fix:** Clean up import lines, delete `windowName` assignment.

### 6. Delete `appendToMemory` from report.ts

Exported, never called anywhere. Memory updates happen via agent instructions + manual file writes, not through this function.

### 7. Remove `resolve` import from index.ts

`resolve` is imported from `path` (line 39) but only appears as a Promise callback parameter name (line 536: `new Promise((resolve) => ...`). The import shadows the parameter name but is never actually used.

### 8. Delete email.test.ts

Every assertion in `email.test.ts` is duplicated in `safety.test.ts` (lines 67-78). `safety.test.ts` is the canonical location for these checks.

### 9. Remove `env: { ...process.env }` from research.ts (line 101)

Bun.spawn inherits the parent environment by default. Spreading it explicitly is a no-op.

### 10. Remove unused `loadConfig` import from calendar.ts

Imported on line 6, never called in any function body.

---

## DO LATER (structural improvements, not urgent)

### 11. Extract serve/reply logic from index.ts

`index.ts` is 651 lines. The serve loop (`cmdServe`, `handleReply`, `extractMessageBody`, `replyContentHash`, `parseDateFromSubject`) is ~140 lines of self-contained logic. Extract to `src/serve.ts`.

Not urgent because it's all in one file and easy to read top-to-bottom. But if more reply features land, this will get unwieldy.

### 12. Migrate `handleReply` from tmux to Bun.spawn

Currently spawns Claude via `tmux split-window` (index.ts line 439-442). Curator was already migrated to `Bun.spawn` with `claude -p`. Reply agents are different though — they use CLI tools interactively, which may benefit from having a terminal.

**My take:** Migrate to `Bun.spawn` like curator. Reply agents don't need a visible terminal — they run tools via `bunx` which works fine headless. Use `claude -p` with `--allowedTools` like curator does. This eliminates the tmux dependency entirely. But test this carefully — if a reply agent needs to do something truly interactive (OAuth re-auth prompt?), headless will fail silently.

### 13. DRY up the TOOLS constant

`cmdCredentials` (line 165) and `cmdAccountsAdd` (line 197) both define the same `[{cmd, label}]` array. Extract to a module-level constant.

### 14. Use Map instead of sparse array in `buildThreadHistory` (reply.ts lines 18-26)

The sparse array `exchanges[idx]` with index-based access is confusing. A `Map<number, {reply, response}>` is clearer.

---

## SKIP (not worth the effort)

- **`os` destructuring in prompt.test.ts** — Cosmetic. `import * as os` vs `import { tmpdir } from "os"` doesn't matter.
- **`report.ts` uses `* as fs` while others destructure** — True but harmless. Enforcing a single import style across files is busywork unless you have a linter rule for it.
- **README milestones are stale** — Low priority. They're historical context from the original spec and serve as a record of how the project evolved. If anything, move them to an appendix rather than deleting.
- **Adding comments to `buildThreadHistory`** — The code is straightforward. A Map (item 14 above) would make it self-documenting without comments.

---

## Summary

The tmux gate in `cmdSend` (#1) is the most impactful fix — it's actively degrading briefing quality when not in tmux, even though the curator no longer needs tmux. The curator polling (#2) is the biggest correctness risk — a crash leads to a silent 3-minute hang. Dead code cleanup (#4-10) is a single focused pass that makes the codebase noticeably cleaner.
