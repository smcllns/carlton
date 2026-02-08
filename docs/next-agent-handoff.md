# Next Agent: Fix Reply Loop Context & Ordering

## Read first
- `docs/prompt-email-reply-loop.md` — full architecture
- `CLAUDE.md` — project rules
- `reports/memory.txt` — accumulated learnings

## Two problems to fix

### 1. Each Claude session is stateless — no thread context

When Carlton spawns Claude for a reply, it only passes the SINGLE latest reply in `.carlton-reply.md`. Claude has no idea what the previous exchanges in the thread were. So when the user says "This is great, always start with a TLDR", Claude doesn't know what "this" refers to.

**Fix:** Include the full thread history in the context file. The replies are already saved in `reports/<date>/responses/` as numbered pairs (NN-reply.md, NN-response.md). The context file should include all previous exchanges so Claude has full conversational context.

In `src/index.ts` `handleReply()`, before writing `.carlton-reply.md`, read all existing files in `reports/<date>/responses/` and include them as "Previous exchanges" in the context.

### 2. Message ordering when multiple replies queue up

When Carlton is busy (Claude is running), replies queue up. When Claude finishes and Carlton polls again, it may find multiple new messages. The current code processes them in whatever order `searchThreads` returns them, which may not be chronological.

**Fix:** Sort messages by `internalDate` or `date` before processing. In the poll loop in `cmdServe`, after collecting unprocessed user messages, sort by date ascending before calling `handleReply`.

### 3. Also consider: `-p` mode and tool use

We just switched from interactive Claude to `claude -p` (print mode). Verify that `-p` mode still uses tools (reads files, runs bun commands, calls gmcli). If `-p` doesn't use tools, switch to `claude -p --verbose` or find the right flag. The permissions are pre-configured in `.claude/settings.json`.

## Key files
- `src/index.ts` — `handleReply()` writes context, `cmdServe()` has the poll loop
- `reports/<date>/responses/` — numbered reply/response pairs
- `.carlton-reply.md` — ephemeral context file passed to Claude
- `.claude/settings.json` — pre-configured permissions

## Test
1. `bun run start` (or `./carlton`)
2. Reply to briefing: "Tell me about the WOEO meeting"
3. Wait for Carlton's response
4. Reply again: "Great, now always include links to sources"
5. Verify Carlton's second response acknowledges the FIRST exchange AND addresses the new feedback
