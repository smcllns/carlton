# TS App vs Skill: Comparison

Tested 2026-02-10 against 2026-02-11 calendar (12 events across 2 accounts).

## Results

| Metric | TS App (main) | Skill (skill/) |
|--------|---------------|----------------|
| Events found | 12 | 12 |
| Briefing lines | 117 | 110 |
| Preamble before heading | Yes (agent leak) | No |
| Location data | Full addresses | Partial (without prompting) |
| Attendee emails | Yes | Partial (without prompting) |
| Timezone handling | Library parses correctly | CLI outputs UTC for some events |
| Research depth | Equivalent | Equivalent |

## Key Differences

### TS app advantages
- **Deterministic detail extraction.** The TS app programmatically extracts every field from the event object (location, attendees, description, conferencing links) and feeds them to the agent. The skill version relies on Claude choosing to look at those fields in CLI output — it *can* get the same data, but doesn't always unless PROMPT.md tells it to.
- **Example from test:** The TS app included the full address for Craftsman and Wolves (from the event's location field). The skill version missed it — not because the CLI couldn't show it, but because Claude didn't extract it from the output. Adding "always include location" to PROMPT.md would fix this.
- **Testability.** The TS app has unit tests (`bun test`) and a safety test that scans for forbidden write calls.

### Skill version advantages
- **Minimal code.** Just `SKILL.md` + a shell script + `PROMPT.md`. No TypeScript, no build, no `node_modules`.
- **No preamble.** The skill version's `SKILL.md` instructions are followed more precisely — briefing starts clean with the heading. The TS app's agent sometimes leaks thinking before the heading.
- **Easier to customize.** Edit `PROMPT.md` and `SKILL.md` directly. No code to understand.

### Equivalent
- Event count and deduplication
- Research quality (Gmail/Drive searches, LinkedIn links, coach details)
- Overall briefing structure and usefulness

## The Core Tradeoff: Determinism vs Simplicity

The TS app is more deterministic — code extracts fields, so they're always present. The skill version can produce equally detailed output, but it depends on Claude noticing and extracting the right details from CLI output. You can close this gap by being more specific in PROMPT.md about what you want (e.g. "always include location, attendee emails, and conferencing links for every meeting").

**TS app (default):** Deterministic detail extraction out of the box. You're comfortable with `bun install` and a TypeScript codebase.

**Skill version:** Simpler setup, fully customizable via PROMPT.md. Less deterministic — Claude may not fetch as many details exhaustively as the app version, unless you specify those details in PROMPT.md.

## Retest

Run `skill/scripts/compare.sh YYYY-MM-DD` to regenerate both briefings and diff them. See `skill/README.md` for details.
