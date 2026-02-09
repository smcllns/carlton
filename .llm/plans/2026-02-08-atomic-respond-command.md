# Atomic `carlton respond` Command — COMPLETE

## Problem
Reply loop bug: spawned Claude agent must execute 4 sequential steps (write response file, call reply-to, update memory, remove lock). Agent frequently stops after step 1, leaving reply unsent and lock stuck.

## Solution
Replace 4-step agent workflow with single atomic `carlton respond <date> <NN>` command. Agent has 2 steps instead of 4.

## Tasks — all complete

- [x] Add `carlton respond <date> <NN>` in src/index.ts, remove `reply-to`
- [x] Simplify buildReplyPrompt to 2-step prompt in src/reply.ts
- [x] Switch spawn from tmux to Bun.spawn in src/serve.ts
- [x] Remove NEW markers from thread.md (redundant with file numbering)
- [x] Remove memory.txt update from reply prompt
- [x] Update test/e2e.ts for new command + no-tmux
- [x] Fix E2E: CARLTON_DELIVERY_EMAIL env var, fd leak, dead code, tighter assertions
- [x] Code review (Haiku + Opus), address findings
- [x] Unit tests: 99 pass. E2E: all 8 steps pass.
- [x] Squashed and pushed as `8aa07f1`, then backlog commit `11c9125`
