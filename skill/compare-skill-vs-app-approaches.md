# TS App vs Skill: Comparison

Tested 2026-02-10 against 2026-02-11 calendar (12 events across 2 accounts).

## Results

| Metric | TS App (main) | Skill (skill/) |
|--------|---------------|----------------|
| Events found | 12 | 12 |
| Briefing lines | 117 | 110 |
| Preamble before heading | Yes (agent leak) | No |
| Location data | Full addresses | Partial (CLI doesn't always expose location) |
| Attendee emails | Yes (from event object) | Sometimes (CLI output varies) |
| Timezone handling | Library parses correctly | CLI outputs UTC for some events |
| Research depth | Equivalent | Equivalent |

## Key Differences

### TS app advantages
- **Full event objects.** The TS app imports gccli/gmcli/gdcli as libraries, giving access to complete event data: location, attendees with emails, description, conferencing links. The skill version calls these as CLIs, which output a text summary that omits some fields.
- **Location field.** The TS app had full addresses for Craftsman and Wolves and Cubberley. The skill version found Cubberley's address via email research but missed the Craftsman and Wolves address entirely (it was only in the event's location field).
- **Testability.** The TS app has unit tests (`bun test`) and a safety test that scans for forbidden write calls.

### Skill version advantages
- **Minimal code.** Just `SKILL.md` + a shell script + `PROMPT.md`. No TypeScript, no build, no `node_modules`.
- **No preamble.** The skill version's `SKILL.md` instructions are followed more precisely — briefing starts clean with the heading. The TS app's agent sometimes leaks thinking before the heading.
- **Easier to customize.** Edit `PROMPT.md` and `SKILL.md` directly. No code to understand.

### Equivalent
- Event count and deduplication
- Research quality (Gmail/Drive searches, LinkedIn links, coach details)
- Overall briefing structure and usefulness

## When to Use Which

**TS app (default):** You want the most complete briefing with full event metadata. You're comfortable with `bun install` and a TypeScript codebase.

**Skill version:** You want a simpler setup, or you're already using Claude Code and want the most lightweight integration. The skill is less deterministic — Claude may not fetch as many details exhaustively as the app version, unless you specify those details in PROMPT.md.

## Retest

Run `skill/scripts/compare.sh YYYY-MM-DD` to regenerate both briefings and diff them. See `skill/README.md` for details.
