# Carlton

Meeting prep from your calendar, researched in parallel, delivered by email. Reply to ask follow-ups.

Carlton fetches your calendar across multiple Google accounts, spawns Claude agents to research each meeting (Gmail, Calendar, Drive), compiles a briefing, and emails it. Reply to the briefing and Carlton picks up the reply, researches your question, and responds in-thread.

**Read-only and isolated.** Carlton never writes to Google services. Email delivery uses [Resend](https://resend.com) (separate auth) so it cannot send email as you, only to you.

## Prerequisites

- [Bun](https://bun.sh)
- [tmux](https://github.com/tmux/tmux) — for the reply handler (`serve`)
  - macOS: `brew install tmux`
  - Linux: `sudo apt install tmux`
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — `npm install -g @anthropic-ai/claude-code`
- Google Cloud project with Calendar, Gmail, and Drive APIs enabled
- [Resend](https://resend.com) API key

## Setup

```bash
git clone https://github.com/smcllns/carlton.git && cd carlton
bun install

# Google OAuth
bun carlton credentials                 # Register your OAuth JSON from credentials/
bun carlton accounts add you@gmail.com  # Opens browser for OAuth
bun carlton setup                       # Verify everything works

# Email delivery
cp .env.example .env                    # Add your RESEND_API_KEY
```

Edit [`PROMPT.md`](PROMPT.md) to configure your accounts, delivery address, and briefing preferences. Run `bun carlton auth` for detailed setup instructions.

## Usage

```bash
bun carlton send [date]          # Research tomorrow (or date), email the briefing
bun carlton [date]               # Just research, no email
```

For the reply loop (polling for email replies and spawning responses), run inside tmux:

```bash
tmux new -s carlton
bun carlton serve
```

Or combine both:

```bash
bun carlton                      # send + serve in one session
```

Output goes to `reports/YYYY-MM-DD/`. Run `bun carlton --help` for all commands.

## Commands

| Command | Purpose |
|---------|---------|
| `bun carlton [date]` | Research a day (local only, no email) |
| `bun carlton send [date]` | Research + email briefing |
| `bun carlton serve` | Poll for email replies and respond (needs tmux) |
| `bun carlton reply-to <subject> <file>` | Send a reply via Resend |
| `bun carlton setup` | Verify auth status |
| `bun carlton auth` | Setup instructions |
| `bun carlton credentials` | Register OAuth JSON |
| `bun carlton accounts add <email>` | Add a Google account |
| `bun test` | Run tests |

## Authentication

Two independent credential sets:

1. **Google OAuth** — Desktop App client from a Google Cloud project (Calendar, Gmail, Drive APIs enabled). Drop the JSON into `credentials/`, run `bun carlton credentials` to register with all three tools (`gccli`, `gmcli`, `gdcli`), then `bun carlton accounts add <email>` to authenticate.
   - Tokens stored at `~/.gccli/`, `~/.gmcli/`, `~/.gdcli/`
   - These CLIs are also directly usable: `bunx gmcli you@gmail.com search "query"`

2. **Resend API key** — set `RESEND_API_KEY` in `.env`. Used only for outbound email delivery, separate from Google auth.

## Security Model

Two isolation boundaries:

1. **Google access is read-only.** Only `search`, `list`, `get` methods are used — never `send`, `create`, `update`, `delete`. [`test/safety.test.ts`](test/safety.test.ts) scans all source files for forbidden method calls and fails the build if any are found.

2. **Email delivery is separated from Google auth.** Carlton uses Resend instead of Gmail's send API. Even if an agent misbehaves, it cannot send email as you or exfiltrate data via Gmail — the Google OAuth tokens lack send capability, and `email.ts` cannot import `google.ts` or access Google credentials (enforced by safety tests). Worst case: a bad email from Carlton's Resend domain, not from your identity.

## Testing

Pragmatic TDD: clear types over coverage, plus one E2E test (`test/e2e.ts`) that exercises the full send → reply → response cycle.

```bash
claude -p "run bun run test:e2e and tell me the results"   # Ask Claude in tmux to run it
```

## Architecture

| Module | Purpose |
|--------|---------|
| `src/index.ts` | CLI entry point and all commands |
| `src/config.ts` | Path helpers and config |
| `src/google.ts` | Wrappers for gccli, gmcli, gdcli |
| `src/calendar.ts` | Multi-account event fetching + dedup |
| `src/report.ts` | Report generation and file output |
| `src/research.ts` | Parallel per-meeting research (spawns Claude agents) |
| `src/curator.ts` | Curator agent context builder |
| `src/reply.ts` | Reply thread handling |
| `src/prompt.ts` | PROMPT.md parser |
| `src/email.ts` | Resend email delivery (isolated from Google) |

## Folder Structure

```
carlton/
├── credentials/          # OAuth credentials (gitignored)
├── src/
│   ├── *.ts             # Implementation
├── test/
│   ├── *.test.ts        # Unit tests
│   ├── e2e.ts           # Full integration test
│   └── safety.test.ts   # Enforce read-only Google access
├── docs/                # Architecture notes and RFCs
├── reports/             # Output (gitignored)
├── PROMPT.md            # User configuration
├── CLAUDE.md            # Agent instructions
├── .env                 # RESEND_API_KEY (gitignored)
└── README.md
```

## Further Reading

- [`docs/loops-framework.md`](docs/loops-framework.md) — Conceptual model for agent-human feedback cycles
- [`docs/prompt-email-reply-loop.md`](docs/prompt-email-reply-loop.md) — Reply loop architecture
- [`PROMPT.md`](PROMPT.md) — User configuration (accounts, delivery, preferences)
- [`CLAUDE.md`](CLAUDE.md) — Agent instructions and safety rules

## Known Limitations

- **Reply agent permissions.** Claude agents spawned to handle replies currently need interactive permission approval via tmux. Once the permission set stabilizes, this can go fully headless.
- **Thread context growth.** Each reply adds to the thread history. No truncation strategy yet — at some point the context will exceed Claude's window.
- **Concurrency.** Multiple parallel replies can write to `reports/` and `memory.txt` simultaneously. No locking mechanism.
