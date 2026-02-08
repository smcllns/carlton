# Carlton

CLI that preps you for tomorrow's meetings. Fetches calendar events across Google accounts, has Claude agents research each one (Gmail threads, Drive docs, past calendar context), and sends you a briefing email via Resend. Reply to the email to ask questions — Carlton researches and responds in-thread.

## Setup

You'll need [Bun](https://bun.sh), [tmux](https://github.com/tmux/tmux) (`brew install tmux`), and [Claude Code](https://docs.anthropic.com/en/docs/claude-code). You'll also need a Google Cloud project with Calendar/Gmail/Drive APIs enabled and a [Resend](https://resend.com) API key.

```bash
git clone https://github.com/smcllns/carlton.git && cd carlton
bun install
bun carlton auth            # Walks you through Google OAuth setup
cp .env.example .env        # Add RESEND_API_KEY
```

Configure your accounts and preferences in [`PROMPT.md`](PROMPT.md).

## Running it

```bash
tmux new -s carlton 'bun carlton'
```

This does two things: runs `send` (research + briefing email) then `serve` (polls for your replies). You can also run them separately — `bun carlton send` doesn't need tmux.

To prep a specific date without emailing: `bun carlton 2026-02-10`

All output lands in `reports/YYYY-MM-DD/`. Run `bun carlton --help` or see the [full command list](#commands) below.

## How send works

Fetches events → spawns parallel Claude haiku agents to research each meeting → curator agent compiles a briefing → emails it via Resend.

## How serve works

Polls Gmail for replies to briefing emails. Spawns a Claude session in a tmux window per reply — it has access to the same Gmail/Calendar/Drive tools to research your question, then sends a threaded response. Each reply sees the full thread history, so context builds up.

Right now reply agents run interactively in tmux so you can approve new permissions as they come up. Once the permission set in `.claude/settings.json` stabilizes, this can go headless.

## Safety

Carlton is read-only against Google — no sending, creating, updating, or deleting anything. [Safety tests](test/safety.test.ts) scan all source files for forbidden method calls and verify that `email.ts` (Resend) never imports Google libraries. The two systems are completely separate: Google credentials can't reach Resend, Resend can't reach Google.

## Commands

```
bun carlton                          # send + serve (requires tmux)
bun carlton <date>                   # Prep for specific date (local only)
bun carlton send [date]              # Research + curate + email briefing
bun carlton send-briefing <date>     # Email an already-written briefing
bun carlton serve                    # Poll for email replies (requires tmux)
bun carlton reply-to <subj> <file>   # Send a threaded reply
bun carlton reset                    # Wipe reports, memory, processed IDs
bun carlton setup                    # Check auth status
bun carlton auth                     # Setup instructions
bun carlton credentials              # Register OAuth credentials
bun carlton accounts add <email>     # Add a Google account
bun test                             # Run tests
```

## Docs

- [Reply loop architecture](docs/prompt-email-reply-loop.md)
- [Loops framework](docs/loops-framework.md)
- [PROMPT.md](PROMPT.md) — accounts, delivery, briefing format
- [CLAUDE.md](CLAUDE.md) — agent instructions and safety rules
