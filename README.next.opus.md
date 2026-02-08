# Carlton

Carlton pulls your calendar across multiple Google accounts, researches each meeting via Gmail/Calendar/Drive, and emails you a briefing. Reply to the email with a follow-up question and it researches and responds in-thread.

Read-only. Carlton never writes to your Google services. Email delivery goes through [Resend](https://resend.com), completely separate from Google auth.

## How it works

`bun carlton send` fetches tomorrow's events, spawns parallel Claude agents to research each meeting (searching Gmail threads, calendar history, Drive docs for context on attendees and topics), then hands everything to a curator agent that compiles a short briefing and emails it to you.

`bun carlton serve` polls your inbox for replies to that briefing. When one arrives, it spawns a Claude agent in a tmux pane to research your question and send a threaded response.

`bun carlton` does both: sends the briefing, then starts listening for replies.

## Prerequisites

- [Bun](https://bun.sh)
- [tmux](https://github.com/tmux/tmux) -- needed for `serve` and the reply loop
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- Google Cloud project with Calendar, Gmail, and Drive APIs enabled
- [Resend](https://resend.com) API key

## Setup

```bash
git clone https://github.com/smcllns/carlton.git && cd carlton
bun install
```

**Google OAuth:**

```bash
bun carlton auth                              # Full setup walkthrough
# Drop your Google Cloud OAuth JSON into credentials/
bun carlton credentials                       # Register it with gccli, gmcli, gdcli
bun carlton accounts add you@gmail.com        # Opens browser for OAuth consent
bun carlton setup                             # Verify everything works
```

One OAuth client credential covers all three Google services. Each account you add gets authenticated against Calendar, Gmail, and Drive. Tokens live in `~/.gccli/`, `~/.gmcli/`, `~/.gdcli/` -- these are the same CLIs you can use directly (e.g. `bunx gmcli you@gmail.com search "query"`).

**Email delivery:**

```bash
cp .env.example .env    # Add your RESEND_API_KEY
```

**Configuration:**

Edit [`PROMPT.md`](PROMPT.md) to set your accounts, delivery address, and briefing preferences.

## Usage

```bash
bun carlton                          # send + serve (requires tmux)
bun carlton send [date]              # Research + email briefing
bun carlton <date>                   # Research locally, no email
bun carlton serve                    # Poll for replies (requires tmux)
```

Default date is tomorrow. Output goes to `reports/YYYY-MM-DD/`.

<details>
<summary>All commands</summary>

```
bun carlton                          # send + serve (requires tmux)
bun carlton <date>                   # Prep for specific date (local only)
bun carlton send [date]              # Research + curate + email briefing
bun carlton send-briefing <date>     # Send an already-written briefing.md
bun carlton serve                    # Poll for email replies (requires tmux)
bun carlton reply-to <subj> <file>   # Send a threaded reply
bun carlton reset                    # Wipe reports, memory, processed IDs
bun carlton setup                    # Check auth status
bun carlton auth                     # Setup instructions
bun carlton credentials              # Register OAuth credentials
bun carlton accounts add <email>     # Add a Google account
```

</details>

## Security model

Two isolation boundaries:

**Google access is read-only.** Only `search`, `list`, `get` operations are used. No `send`, `create`, `update`, `delete`. [`test/safety.test.ts`](test/safety.test.ts) scans all source files for forbidden method calls and fails the build if any appear.

**Email delivery is separated from Google auth.** Carlton sends briefings *to* you via Resend -- it cannot send *as* you. `email.ts` cannot import `google.ts` or access Google credentials (also enforced by safety tests). The worst case for a misbehaving agent is a bad email from Carlton's Resend domain, not from your identity.

Data flow: Google (read) --> Carlton (process) --> Resend (send to user)

## Testing

```bash
bun test                             # Unit + safety tests
```

The E2E test (`test/e2e.ts`) exercises the full send, reply, and response cycle. It requires tmux:

```bash
tmux new -s carlton-test 'bun test/e2e.ts'
```

## Open questions

The briefing pipeline is solid. The reply loop is where the hard problems are:

- **Permission bootstrapping.** Reply agents need interactive tmux approval for tool permissions before going headless. How many sessions until the permission set stabilizes?
- **Agent quality control.** A spawned Claude can research, write files, and send email. No guardrails beyond safety tests on Google writes prevent a bad response from going out.
- **Concurrency.** Multiple replies spawn parallel tmux panes, all reading/writing to the same `reports/` directory. No locking.
- **Context window limits.** Thread history grows with each reply. No truncation strategy yet for when it exceeds what Claude can usefully process.

## Project structure

```
carlton/
├── src/
│   ├── index.ts          # CLI entry point
│   ├── config.ts         # Path helpers
│   ├── google.ts         # Gmail, Calendar, Drive wrappers
│   ├── calendar.ts       # Multi-account event fetching + dedup
│   ├── research.ts       # Parallel per-meeting research via Claude
│   ├── curator.ts        # Curator agent that compiles the briefing
│   ├── report.ts         # Report generation + file output
│   ├── reply.ts          # Reply thread handling
│   ├── prompt.ts         # PROMPT.md parser
│   └── email.ts          # Resend delivery (isolated from Google)
├── test/                 # Unit, safety, and E2E tests
├── docs/                 # Architecture notes and RFCs
├── credentials/          # OAuth credentials (gitignored)
├── reports/              # All output (gitignored)
├── PROMPT.md             # User config
├── CLAUDE.md             # Agent instructions
└── .env                  # RESEND_API_KEY (gitignored)
```

## Further reading

- [Reply loop architecture](docs/prompt-email-reply-loop.md)
- [Loops framework](docs/loops-framework.md) -- agent-human feedback cycles
- [`PROMPT.md`](PROMPT.md) -- user config
- [`CLAUDE.md`](CLAUDE.md) -- agent instructions
