# Notes: PROMPT.md Config, Email Delivery, Reply Loop

## What was done

Added three capabilities to Carlton:

1. **PROMPT.md as structured config** — `src/prompt.ts` parses PROMPT.md into sections (System, Accounts, Delivery, Briefing Format, Research Instructions). Accounts are email bullet lists. Delivery is key-value (email, time, timezone). Freeform sections passed through as strings.

2. **Email delivery via Resend** — `src/email.ts` sends briefings using the Resend transactional email API. Architecturally isolated from Google services (cannot import google.ts — enforced by safety tests in both `email.test.ts` and `safety.test.ts`).

3. **Reply polling loop** — `bun carlton serve` polls Gmail (read-only) for replies to Carlton briefing emails, using subject-line matching. Reply processing pipeline is stubbed — needs Milestone 3 research capabilities first.

## Key Architecture Decisions

- **Resend vs Gmail for sending**: Google services are strictly read-only. Even if an agent goes rogue, it cannot send email as the user, modify calendar events, or touch Drive files. Email delivery uses a completely separate API (Resend) with its own API key.

- **email.ts ↔ google.ts boundary**: These modules must never import each other. This is the core security invariant. Tested in two places.

- **PROMPT.md parser**: Simple `## ` heading splitter. No YAML/TOML parser needed. Accounts extracted by finding lines with `@`. Delivery config extracted as `key: value` pairs from bullet lists.

- **Resend sandbox**: Currently sends from `onboarding@resend.dev`. For production reply threading, a verified custom domain would be better. Fine for MVP.

## Files Created
- `src/prompt.ts` — PROMPT.md parser
- `src/prompt.test.ts` — 8 test cases
- `src/email.ts` — Resend wrapper (sendBriefing, sendReply)
- `src/email.test.ts` — isolation boundary tests
- `.env.example` — API key placeholder

## Files Modified
- `PROMPT.md` — restructured into parseable sections
- `src/index.ts` — refactored cmdPrep → prepBriefing(), added send/serve commands
- `src/safety.test.ts` — added email↔google boundary test
- `.gitignore` — added .env, !reports/memory.txt
- `README.md` — security model, new commands, folder structure, milestone 2.5
- `CLAUDE.md` — key files updated, security architecture section

## What's Next
- Set up Resend API key and test `bun carlton send` end-to-end
- Reply processing (3.3) depends on Milestone 3 cross-service research
- Consider custom domain for Resend to enable proper reply threading
