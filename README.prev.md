# Carlton

Meeting prep on autopilot. Carlton fetches your calendar across multiple Google accounts, spawns AI agents to research each meeting, and emails you a briefing — then stays on the line for follow-up questions via email reply.

## What it actually does

**1. Researches your meetings while you sleep.** `bun carlton send` spawns parallel Claude agents that dig through your Gmail, Calendar, and Drive for context on each meeting — attendees, past threads, relevant docs — then a curator compiles it all into a short briefing email.

**2. Answers follow-up questions.** Reply to the briefing email and Carlton picks it up, researches your question, and sends a threaded response. Ask "what's the context on this project?" and it goes looking.

**3. Stays read-only and safe.** Carlton reads your Google data but can never write to it — no sending emails as you, no creating events, no touching your Drive files. Email delivery uses a separate service (Resend) that sends *to* you, not *as* you. Safety tests enforce this.

## Prerequisites

- [Bun](https://bun.sh)
- [tmux](https://github.com/tmux/tmux) — needed for `serve` (reply handling)
  ```bash
  brew install tmux        # macOS
  sudo apt install tmux    # Ubuntu/Debian
  ```
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`)
- A Google Cloud project with Calendar, Gmail, and Drive APIs enabled
- A [Resend](https://resend.com) API key for email delivery

## Setup

```bash
git clone https://github.com/smcllns/carlton.git && cd carlton
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

## Quick start

```bash
# Full daily workflow (research + email + reply handling)
tmux new -s carlton 'bun carlton'

# Just research and email, no reply handling
bun carlton send

# Prep for a specific date (local only, no email)
bun carlton 2026-02-10
```

Reports are written to `reports/YYYY-MM-DD/`.

<details>
<summary><strong>All commands</strong></summary>

```
bun carlton                          # send + serve (requires tmux)
bun carlton <date>                   # Prep for specific date (local only)
bun carlton send [date]              # Research + curate + email briefing
bun carlton send-briefing <date>     # Send an already-written briefing.md
bun carlton serve                    # Poll for email replies (requires tmux)
bun carlton reply-to <subj> <file>   # Send a threaded reply via Resend
bun carlton reset                    # Wipe reports, memory, processed IDs
bun carlton setup                    # Check auth status
bun carlton auth                     # Setup instructions
bun carlton credentials              # Register OAuth credentials
bun carlton accounts add <email>     # Add a Google account
bun test                             # Run tests
```

</details>

## Status

**Working end-to-end:**
- Multi-account calendar fetching with cross-account dedup
- Parallel AI research per meeting (Gmail, Calendar, Drive lookups)
- Curator pipeline that compiles research into a short briefing email
- Email delivery via Resend
- Reply loop — reply to the briefing, get a researched response back
- Thread history — each reply carries context from previous exchanges
- E2E integration test covering the full send → reply → response cycle
- Safety tests enforcing read-only Google access

**Next up:**
- Permission NUX stabilization — reply agents currently need tmux for interactive permission approval; once the permission set settles, can go fully headless
- Accountability follow-up loop — resurface dropped commitments

## Security model

Carlton separates **reading user data** from **sending output**:

- **Google services are read-only** — enforced by code and [safety tests](test/safety.test.ts). Carlton can search, list, and get. It cannot send, create, update, or delete.
- **Email delivery uses Resend**, a separate API. Carlton sends briefings *to* the user — it cannot send *as* the user.
- **`email.ts` is isolated from Google** — it cannot import `google.ts` or access Google credentials.
- **Data flow:** Google (read) → Carlton (process) → Resend (send to user)

## Further reading

- [`docs/loops-framework.md`](docs/loops-framework.md) — Framework for thinking about agent-human feedback cycles
- [`docs/prompt-email-reply-loop.md`](docs/prompt-email-reply-loop.md) — Reply loop architecture and design
- [`PROMPT.md`](PROMPT.md) — User config (accounts, delivery, briefing format)
- [`CLAUDE.md`](CLAUDE.md) — Agent instructions and safety rules
