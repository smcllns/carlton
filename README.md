# Carlton

A daily meeting briefing assistant. Fetches your calendar across multiple Google accounts, spawns parallel Claude agents to research each meeting (across Gmail, Calendar, Drive), compiles and emails you a briefing.

**Read-only and isolated.** Carlton uses [Resend](https://resend.com) for email delivery, separate from Google auth. Carlton can send email to you, not as you.

## Prerequisites

- [Bun](https://bun.sh) — runtime and package manager
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — `npm install -g @anthropic-ai/claude-code`
- Google Cloud OAuth credentials — for Calendar, Gmail, and Drive API access
- [Resend](https://resend.com) API key — for sending briefings to you

## Setup

```bash
git clone https://github.com/smcllns/carlton.git && cd carlton
bun install
bun link                                # Makes `carlton` available globally

# Google OAuth
bun carlton credentials                 # Register your OAuth JSON from credentials/
bun carlton accounts add you@gmail.com  # Opens browser for OAuth
bun carlton setup                       # Verify everything works

# Email delivery
cp .env.example .env                    # Add your RESEND_API_KEY
```

Edit `PROMPT.md` to configure your accounts, delivery address, and briefing preferences. Run `bun carlton auth` for detailed setup instructions.

## Usage

```bash
carlton send                         # Research + curate + send for tomorrow
carlton send 2026-02-10              # Same, for specific date
carlton send --resend                # Re-run curator, keep existing research
carlton send --test                  # Nuke date folder, full fresh run
carlton [date]                       # List events (no research)
carlton reset                        # Wipe all reports (keeps auth)
carlton help                         # Show all commands
```

`send` is fully automated: research agents run in parallel, curator compiles the briefing, email sends — all in one command.

Output goes to `reports/YYYY-MM-DD/`.

## Security

1. **Google access is read-only.** Only `search`, `list`, `get` methods are used. [`test/safety.test.ts`](test/safety.test.ts) scans all source files for forbidden write calls.

2. **Email delivery is isolated from Google auth.** Resend sends as Carlton, not as you. `email.ts` cannot import `google.ts` (enforced by safety tests).

## Architecture

```
PROMPT.md (config)
    ↓
fetch calendar events (gccli)
    ↓
research each meeting in parallel (Claude agents using gmcli, gccli, gdcli)
    ↓ writes reports/<date>/research/*.md
curator (claude -p) compiles research + PROMPT.md
    ↓ writes reports/<date>/briefing.md
send → email via Resend
```

| Module | Purpose |
|--------|---------|
| `src/index.ts` | CLI entry point and commands |
| `src/prompt.ts` | PROMPT.md parser |
| `src/calendar.ts` | Multi-account event fetching + dedup |
| `src/research.ts` | Parallel per-meeting research agents |
| `src/curator.ts` | Compiles research into briefing |
| `src/email.ts` | Resend email delivery |
| `src/google.ts` | Wrappers for gccli, gmcli, gdcli |
| `src/config.ts` | Path helpers |

## Testing

```bash
bun test    # Unit + safety tests
```
