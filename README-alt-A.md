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

# Google OAuth — drops credentials and authenticates each account
bun carlton credentials                       # Register your OAuth JSON from credentials/
bun carlton accounts add you@gmail.com        # Opens browser for OAuth
bun carlton setup                             # Verify everything works

# Set up your .env file with Resend key
cp .env.example .env
```

Edit [`PROMPT.md`](PROMPT.md) to configure your accounts, delivery address, and briefing preferences. Run `bun carlton auth` for detailed setup instructions.

## Usage

```bash
bun carlton [date]                   # Research tomorrow (or date), local only
bun carlton send [date]              # Same but emails the briefing
```

Carlton spawns parallel Claude sessions to handle replies, so run it inside tmux to manage them:

```bash
# Run tmux before running Claude to help manage parallel Claude sessions
tmux new -s carlton
bun carlton serve
```

Output goes to `reports/YYYY-MM-DD/`. Run `bun carlton --help` for all commands.

### Testing

Pragmatic TDD — clear types over high coverage, and one E2E test (`test/e2e.ts`) that exercises the full send → reply → response cycle. Ask Claude to run it from inside a tmux session:

```bash
claude -p "run bun run test:e2e and tell me the results"   # Ask claude in tmux to run the e2e tests!
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
│   └── email.ts          # Resend email delivery (isolated from Google)
├── test/                 # Unit + E2E tests
├── docs/                 # Architecture notes, RFCs, agent handoff docs
├── reports/              # All output (gitignored)
├── PROMPT.md             # User config (accounts, delivery, format)
├── .env                  # RESEND_API_KEY (gitignored)
├── CLAUDE.md             # Agent instructions
└── README.md
```

## Docs

- [Reply loop architecture](docs/prompt-email-reply-loop.md)
- [Loops framework](docs/loops-framework.md) — how Carlton fits into a broader agent-human feedback model
- [PROMPT.md](PROMPT.md) — user config
- [CLAUDE.md](CLAUDE.md) — agent instructions
