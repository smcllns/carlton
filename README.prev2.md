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

## Auth

Two sets of credentials:

- **Google OAuth client credentials** — a Desktop App client from a Google Cloud project with Calendar, Gmail, and Drive APIs enabled. Drop the JSON into `credentials/` and run `bun carlton credentials` to register it with all three CLI tools (`gccli`, `gmcli`, `gdcli`). Then `bun carlton accounts add <email>` authenticates an account across all three.
- **Resend API key** — set `RESEND_API_KEY` in `.env`. Used only for outbound email delivery.

OAuth tokens are stored per-tool at `~/.gccli/`, `~/.gmcli/`, `~/.gdcli/`. These are the same CLIs you can use directly to query Google services (e.g. `bunx gmcli you@gmail.com search "query"`).

## Security Model

Two isolation boundaries:

1. **Google access is read-only.** Only `search`, `list`, `get` methods are used — no `send`, `create`, `update`, `delete`. [`test/safety.test.ts`](test/safety.test.ts) scans all source files for forbidden method calls and fails the build if any are found.

2. **Email delivery is deliberately separated from Google auth.** Carlton uses Resend (a third-party transactional email service) instead of Gmail's send API. This means even if an agent misbehaves, it cannot send email as the user or exfiltrate data through their Gmail account — the Google OAuth tokens have no send capability, and `email.ts` cannot import `google.ts` or access Google credentials (enforced by safety tests). The worst case is a bad email sent from Carlton's Resend domain, not from the user's identity.

## Open Questions

The briefing pipeline works. The reply loop is where the hard problems are:

- **Permission bootstrapping.** Reply agents need to approve tool permissions interactively via tmux before they can go headless. How many sessions until the permission set stabilizes? Can we seed a good default set?
- **Agent quality control.** A spawned Claude can research, write files, and send email. What guardrails prevent a bad response from going out? Currently: none beyond the safety tests on Google writes.
- **Concurrency.** Multiple replies can arrive while an agent is working. They spawn in parallel tmux panes, but they're all reading/writing to the same `reports/` directory and `memory.txt`. No locking.
- **Context window limits.** Thread history grows with each reply. At some point the context file exceeds what Claude can usefully process. No truncation strategy yet.
- **Memory vs. code changes.** When a user says "always start with a joke", should that go in `memory.txt` (read by future agents) or in `src/report.ts` (changes the code)? Currently agents do both inconsistently.

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
