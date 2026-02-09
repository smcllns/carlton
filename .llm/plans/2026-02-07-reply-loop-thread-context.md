# Fix Reply Loop: Thread Context, Memory, and Message Ordering

## Status: Complete

## Tasks

- [x] 1. Include thread history in `.carlton-reply.md` context (handleReply ~line 357)
- [x] 2. Update memory.txt instructions — only log user preferences, not process notes
- [x] 3. Sort messages chronologically in cmdServe poll loop
- [x] 4. Spawn Claude in tmux windows (interactive, parallel)
- [x] 5. Require tmux for serve, document prerequisites
- [x] 6. Run `bun test`, verify passes (42/42 pass)
- [x] 7. Test tmux integration (serve startup, window spawning)

## Files Modified
- `src/index.ts` — thread history, memory instructions, chronological sort, tmux spawning
- `.gitignore` — cover numbered context files (`.carlton-reply*.md`)

## Notes
- See `.llm/notes/reply-loop-architecture.md` for full decision history on tmux vs headless
