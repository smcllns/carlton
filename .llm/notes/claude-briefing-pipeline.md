# Claude-Powered Briefing Pipeline — Notes

## Architecture

`cmdSend()` now has two paths:
1. **No tmux** → fallback to `formatBasicReport()` and send directly (unchanged behavior)
2. **In tmux** → research phase (parallel `claude -p` with haiku) → curator phase (interactive Claude in tmux window)

## New Files

### `src/research.ts`
- `buildResearchPrompt()` builds a prompt per event with CLI tool examples, attendee list, accounts
- `runResearch()` spawns N parallel `claude -p` processes, each writing to `reports/<date>/research/<NN>-research.md`
- 90s timeout per research process, uses `--model haiku` and `--allowedTools` to scope tool access
- Uses `--output-file` flag; falls back to capturing stdout if file not created

### `src/curator.ts`
- `buildCuratorContext()` assembles: research results (or fallback event data), memory.txt, briefing format from PROMPT.md, self-improvement instructions
- `spawnCurator()` opens a tmux window with interactive Claude that reads the context file
- Curator writes `reports/<date>/briefing.md` then runs `bun carlton send-briefing <date>`
- Self-improvement: curator can read `src/**` and write `src/*.self.md` proposals (not direct .ts edits)

### `send-briefing` command
- Reads `reports/<date>/briefing.md` and sends via Resend
- Separated from `cmdSend()` so the curator can call it after writing the briefing

## Reply Dedup Fix
- Changed from `msg.id` (unique per Gmail account) to `sha256(from|subject|snippet|date).slice(0,16)`
- Same `.carlton-processed-ids` file, just different key values
- Prevents duplicate processing when same reply appears in multiple Gmail accounts

## Decisions
- Curator uses user's default Claude model (no `--model` flag) — lets the user control quality/cost
- Research uses haiku for speed and cost since it's doing structured lookups
- `formatBasicReport()` stays as fallback — not removed, still used when not in tmux
- Existing `.carlton-processed-ids` file will mix old msg.id entries with new hashes — harmless since they won't collide

## Test Status
- All 64 tests pass
- Fixed 2 pre-existing failures in report.test.ts (emoji prefix mismatch)
- Safety tests still pass — new files are read-only compliant
