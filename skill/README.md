# Carlton — Skill Version

A zero-code alternative to the main TypeScript app. The entire pipeline is a Claude Code skill defined in `SKILL.md`, with `PROMPT.md` as the only config.

> **Note:** The TS app (root of this repo) produces better briefings because it accesses full event objects via library imports. The skill version uses CLI tools which omit some fields (location, attendee emails). See [compare-skill-vs-app-approaches.md](compare-skill-vs-app-approaches.md) for details.

## Setup

1. Install prerequisites: [Bun](https://bun.sh), [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
2. Auth Google CLI tools for each account:
   ```bash
   bunx gccli accounts credentials credentials/your-client-secret.json
   bunx gmcli accounts credentials credentials/your-client-secret.json
   bunx gdcli accounts credentials credentials/your-client-secret.json
   bunx gccli accounts add you@gmail.com
   bunx gmcli accounts add you@gmail.com
   bunx gdcli accounts add you@gmail.com
   ```
3. Copy and edit the config:
   ```bash
   cp skill/PROMPT.md.example PROMPT.md   # Edit with your accounts and preferences
   ```
4. Set `RESEND_API_KEY` in `.env`
5. Symlink `skill/SKILL.md` to project root:
   ```bash
   ln -s skill/SKILL.md SKILL.md
   ```

## Usage

```
/carlton                         # Research + send briefing for tomorrow
/carlton send 2026-02-11         # Specific date
/carlton send --test             # Clear previous run, send fresh
/carlton 2026-02-11              # List events only (no research/send)
```

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Skill definition — pipeline, allowed tools, safety |
| `PROMPT.md.example` | Template config — copy to `PROMPT.md` and edit |
| `scripts/send-briefing.sh` | Email sending — markdown→HTML + Resend API |
| `compare-skill-vs-app-approaches.md` | TS app vs skill: detailed comparison |
| `scripts/compare.sh` | Run both versions and diff the results |

## Retest Comparison

```bash
skill/scripts/compare.sh 2026-02-11
```

This runs the TS app automatically, then prints instructions for running the skill version manually. Once both briefings exist, re-run to see the diff.
