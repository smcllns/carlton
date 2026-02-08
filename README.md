# Carlton

Read-only meeting prep CLI. Pulls calendar events across multiple Google accounts, researches each meeting via Gmail/Calendar/Drive, and emails you a daily briefing.

## Prerequisites

- [Bun](https://bun.sh)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`)
- A Google Cloud project with Calendar, Gmail, and Drive APIs enabled
- A [Resend](https://resend.com) API key for email delivery

## Setup

```bash
git clone <repo> && cd carlton
bun install

# Auth setup
bun carlton auth                              # Shows full setup instructions
# Drop your Google Cloud OAuth JSON into credentials/
bun carlton credentials                       # Register with all Google tools
bun carlton accounts add you@gmail.com        # Add account (opens browser for OAuth)
bun carlton setup                             # Verify auth

# Email delivery
cp .env.example .env                          # Add your RESEND_API_KEY
```

Then edit `PROMPT.md` with your accounts, delivery email, and preferences.

## Usage

```bash
bun carlton                          # send + serve (requires tmux)
bun carlton 2026-02-10               # Prep for specific date (local only, no email)
bun carlton send                     # Research + curate + email tomorrow's briefing
bun carlton send 2026-02-10          # Research + curate + email for specific date
bun carlton send-briefing 2026-02-10 # Send an already-written briefing.md
bun carlton serve                    # Poll for email replies, spawn Claude agents (requires tmux)
bun carlton reply-to <subj> <file>   # Send a threaded reply via Resend
bun carlton reset                    # Wipe reports, memory, processed IDs (keeps auth)
bun carlton setup                    # Check auth status
bun carlton auth                     # Setup instructions
bun carlton credentials              # Register OAuth credentials
bun carlton accounts add <email>     # Add a Google account
bun test                             # Run tests
```

Reports are written to `reports/YYYY-MM-DD/`.

### How `send` works

1. Fetches calendar events for the target date across all configured accounts
2. Spawns parallel Claude agents (haiku) to research each meeting via Gmail, Calendar, and Drive
3. Hands all research to a curator agent that compiles a polished briefing
4. Curator sends the briefing email via Resend

No tmux required. Runs headlessly.

### How `serve` works

Polls Gmail for replies to briefing emails. When a reply is detected, spawns an interactive Claude agent in a tmux window to research and respond. Requires tmux.

```bash
tmux new -s carlton
bun carlton serve
```

### E2E test

```bash
tmux new -s carlton-test 'bun test/e2e.ts'
```

## Security Model

Carlton separates **reading user data** from **sending output**:

- **Google services (Gmail, Calendar, Drive) are read-only** — enforced by code and safety tests. Carlton can search, list, and get. It cannot send, create, update, or delete.
- **Email delivery uses Resend**, a separate transactional email API. Carlton sends briefings *to* the user — it cannot send *as* the user.
- **`src/email.ts` is isolated from Google** — it cannot import `google.ts` or access Google credentials. Safety tests enforce this.
- **Data flow:** Google (read) → Carlton (process) → Resend (send to user)

## Auth Strategy

- One Google Cloud project with Gmail API, Calendar API, and Drive API enabled
- One OAuth Desktop App client → download credentials JSON
- `bun carlton credentials` registers the same credentials file with all three tools
- `bun carlton accounts add you@gmail.com` adds an account to all three tools in one command
- Tokens stored separately in `~/.gmcli/`, `~/.gccli/`, `~/.gdcli/`

## Folder Structure

```
carlton/
├── credentials/          # OAuth credentials (gitignored)
├── src/
│   ├── index.ts          # CLI entry point and all commands
│   ├── config.ts         # Path helpers
│   ├── google.ts         # Service wrappers (gmail, calendar, drive)
│   ├── calendar.ts       # Multi-account event fetching + dedup
│   ├── report.ts         # Report generation + file output
│   ├── research.ts       # Parallel per-meeting research via Claude agents
│   ├── curator.ts        # Curator agent context builder + runner
│   ├── reply.ts          # Reply thread handling
│   ├── prompt.ts         # PROMPT.md parser
│   ├── email.ts          # Resend email delivery (isolated from Google)
│   └── *.test.ts         # Tests
├── reports/              # All output (gitignored)
├── PROMPT.md             # User config (accounts, delivery, format)
├── .env                  # RESEND_API_KEY (gitignored)
├── CLAUDE.md             # Agent instructions
└── README.md
```
