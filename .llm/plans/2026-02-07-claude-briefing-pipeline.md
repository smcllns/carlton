# Claude-Powered Briefing Pipeline + Self-Improvement

## Status: COMPLETE

## Tasks

- [x] 1. Fix reply dedup bug — content hash instead of msg.id
- [x] 2. Create src/research.ts — parallel claude -p research per event
- [x] 3. Create src/curator.ts — curator context + tmux spawn
- [x] 4. Add send-briefing command to CLI
- [x] 5. Rewrite cmdSend() to use research → curator pipeline
- [x] 6. Update .claude/settings.json permissions
- [x] 7. Fix report.test.ts emoji failures
- [x] 8. Run tests, verify all pass (64/64)
- [x] 9. Email subject → "YYYY-MM-DD Carlton Briefing Notes"
- [x] 10. Add unique TLDR + sent marker to prevent double-send
- [x] 11. Consolidate permissions into tracked settings.json
- [x] 12. Move stop hook to tracked settings

## Unresolved (from plan)

1. **Curator model** — defaults to user's Claude config (no --model flag)
2. **Research timeout** — set to 90s, tunable after real usage
3. **.self.md tracked in git?** — currently yes, they end up in src/

## Next: E2E test

Pipeline hasn't been tested live yet (needs Google auth + tmux). Run `bun carlton send` in tmux to verify research agents spawn and curator produces a briefing.
