# Carlton

Pulls your calendar across multiple Google accounts, researches each meeting via Gmail/Calendar/Drive, and emails you a briefing. You can reply to the email to ask follow-up questions — Carlton picks up the reply, researches, and responds in-thread.

Read-only. Carlton never writes to your Google services. Email delivery is via [Resend](https://resend.com), separate from Google auth entirely.

## Prerequisites

- [Bun](https://bun.sh)
- [tmux](https://github.com/tmux/tmux) — `brew install tmux` (macOS) or `sudo apt install tmux` (Debian)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — `npm install -g @anthropic-ai/claude-code`
- Google Cloud project with Calendar, Gmail, and Drive APIs enabled
- [Resend](https://resend.com) API key

## Setup

```bash
git clone https://github.com/smcllns/carlton.git && cd carlton
bun install

bun carlton auth                              # Setup instructions
# Drop your Google Cloud OAuth JSON into credentials/
bun carlton credentials                       # Register with all Google tools
bun carlton accounts add you@gmail.com        # Opens browser for OAuth
bun carlton setup                             # Verify everything works

cp .env.example .env                          # Add your RESEND_API_KEY
```

Edit [`PROMPT.md`](PROMPT.md) to configure your accounts, delivery address, and briefing preferences.

## Usage

```bash
tmux new -s carlton 'bun carlton'     # Research + email + reply handling
bun carlton send                      # Just research and email (no tmux needed)
bun carlton 2026-02-10                # Specific date, local only, no email
```

Output goes to `reports/YYYY-MM-DD/`.

## How it works

`send` fetches events across all configured accounts, spawns parallel Claude agents (haiku) to research each meeting, then hands everything to a curator agent that writes and emails the briefing.

`serve` polls Gmail for replies to the briefing. When you reply, it spawns a Claude session in a tmux window to research your question and send a threaded response back. Thread history carries across replies so context accumulates.

## Status

This works end-to-end: multi-account calendar, parallel research, curator pipeline, email delivery, reply loop with thread history, and an E2E test that covers the full cycle.

Still needs work: reply agents require tmux for interactive permission approval — once the permission set stabilizes, this can go fully headless.

## Security

Google access is strictly read-only — search, list, get. No sends, creates, updates, or deletes. This is enforced by [safety tests](test/safety.test.ts) that scan all source files for forbidden method calls.

Email delivery uses Resend, which is completely separate from Google auth. `email.ts` cannot import `google.ts` or access Google credentials (also enforced by safety tests).

Data flow: Google (read) → Carlton (process) → Resend (send to user)

## All commands

| Command | What it does |
|---------|-------------|
| `bun carlton` | `send` + `serve` (requires tmux) |
| `bun carlton <date>` | Prep for a date, local only |
| `bun carlton send [date]` | Research + curate + email |
| `bun carlton send-briefing <date>` | Email an already-written briefing |
| `bun carlton serve` | Poll for reply emails (requires tmux) |
| `bun carlton reply-to <subj> <file>` | Send a threaded reply |
| `bun carlton reset` | Wipe reports, memory, processed IDs |
| `bun carlton setup` | Check auth status |
| `bun carlton auth` | Show setup instructions |
| `bun carlton credentials` | Register OAuth credentials |
| `bun carlton accounts add <email>` | Add a Google account |
| `bun test` | Run tests |

## Docs

- [Reply loop architecture](docs/prompt-email-reply-loop.md)
- [Loops framework](docs/loops-framework.md) — how Carlton fits into a broader agent-human feedback model
- [PROMPT.md](PROMPT.md) — user config
- [CLAUDE.md](CLAUDE.md) — agent instructions
