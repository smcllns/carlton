# Carlton

An agent who manages subagents working across your calendar, docs and inbox, communicating by email. 

Carlton fetches your calendar across multiple Google accounts, manages multiple parallel Claude agents to research different areas (across Gmail, Calendar, Drive), compiles and emails briefing notes to you. 

**Reply to ask follow-ups.** You can reply to the briefing and Carlton will pick it up, research your question, and respond in-thread with a research answer based on your data sources.

**Read-only and isolated.** Carlton uses [Resend](https://resend.com) for email message delivery (sending you email reports and research follow-ups) which is a separate auth provider and allows us to be restrictive on Google side permissions. In other words, Carlton can send email to you, not as you.

## Prerequisites

- [Bun](https://bun.sh) - runtime, build system, package manager
- [tmux](https://github.com/tmux/tmux) — for managing multiple dynamic claude code instances (`serve`)
  - macOS: `brew install tmux`
  - Linux: `sudo apt install tmux`
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — `npm install -g @anthropic-ai/claude-code`
- Google Cloud OAuth credentials - for Calendar, Gmail, and Drive API auth
- [Resend](https://resend.com) API key - for Carlton to be able to email you

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

2. **Resend API key** — set `RESEND_API_KEY` in `.env`. For sending email from Carlton to you, which you can then reply to and Carlton picks up via Gmail. Separate from Google auth.

## Security Model

Two isolation boundaries:

1. **Google access is read-only.** Only `search`, `list`, `get` methods are used — never `send`, `create`, `update`, `delete`. [`test/safety.test.ts`](test/safety.test.ts) scans all source files for forbidden method calls and fails the build if any are found.

2. **Email delivery is separated from Google auth.** Carlton uses Resend instead of Gmail's send API. Even if an agent misbehaves, it cannot send email as you or exfiltrate data via Gmail — the Google OAuth tokens lack send capability, and `email.ts` cannot import `google.ts` or access Google credentials (enforced by safety tests). Worst case: a bad email from Carlton's Resend domain, not from your identity.

## Testing

Pragmatic TDD: clear types over coverage, plus one E2E test (`test/e2e.ts`) that exercises the full send → reply → response cycle.

```bash
bun test                                                    # Unit tests
bun run test:e2e                                            # E2E in a tmux split pane
claude -p "run bun run test:e2e and tell me the results"    # ...or let Claude run it and read the results
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

## Open Questions

The briefing pipeline works. The reply loop is where the hard problems are:

- **Permission bootstrapping.** Reply agents need to approve tool permissions interactively via tmux before they can go headless. How many sessions until the permission set stabilizes? Can we seed a good default set?
- **Agent quality control.** A spawned Claude can research, write files, and send email. What guardrails prevent a bad response from going out? Currently: none beyond the safety tests on Google writes.
- **Concurrency.** Multiple replies can arrive while an agent is working. They spawn in parallel tmux panes, but they're all reading/writing to the same `reports/` directory and `memory.txt`. No locking.
- **Context window limits.** Thread history grows with each reply. At some point the context file exceeds what Claude can usefully process. No truncation strategy yet.
- **Memory vs. code changes.** When a user says "always start with a joke", should that go in `memory.txt` (read by future agents) or in `src/report.ts` (changes the code)? Currently agents do both inconsistently.
- **One session per day.** Right now each reply spawns a new stateless Claude. Ideally there's one long-running Claude session per day (`claude --continue`) that handles all replies with full context — no thread history stitching, no parallel agent sprawl. The current architecture over-spawns.

---

## For LLMs

If you're an agent working on this codebase:

1. **[`CLAUDE.md`](CLAUDE.md)** — Safety rules, file map, what you can and can't do. Read first, non-negotiable.
2. **[`reports/memory.txt`](reports/memory.txt)** — Accumulated learnings from previous agents. Don't repeat mistakes already logged here.
3. **[`PROMPT.md`](PROMPT.md)** — User config (accounts, preferences). Read it, don't modify it.
