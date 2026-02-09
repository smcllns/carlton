# Plan: PROMPT.md Config, Email Delivery, Reply Loop

## Status: Complete

## Tasks

- [x] **Phase 1: PROMPT.md as Config**
  - [x] 1.1 Restructure PROMPT.md into parseable sections
  - [x] 1.2 Create `src/prompt.ts` — parser
  - [x] 1.3 Create `src/prompt.test.ts` — parser tests
  - [x] 1.4 Update `src/index.ts` — use prompt config in cmdPrep

- [x] **Phase 2: Email Delivery via Resend**
  - [x] 2.1 Add deps (resend, marked)
  - [x] 2.2 .env setup (.gitignore, .env.example)
  - [x] 2.3 Create `src/email.ts` — Resend wrapper
  - [x] 2.4 Refactor cmdPrep → prepBriefing()
  - [x] 2.5 Add `send` command
  - [x] 2.6 Update safety tests (email↔google boundary)

- [x] **Phase 3: Reply Loop**
  - [x] 3.1 Add `serve` command (polling loop, 30s interval)
  - [x] 3.2 Reply detection (Gmail searchThreads, read-only)
  - [x] 3.3 Spawn interactive Claude on reply detection
  - [x] 3.4 Structured reply storage in reports/<date>/responses/
  - [x] 3.5 Git snapshot before every email send
  - [x] 3.6 Persisted processed message IDs (.carlton-processed-ids)

- [x] **Phase 4: Documentation + Permissions**
  - [x] 4.1 Security Model in README.md
  - [x] 4.2 Security Architecture in CLAUDE.md
  - [x] 4.3 Update README (folder structure, commands, milestones)
  - [x] 4.4 Pre-configured permissions in .claude/settings.json

- [x] **Phase 5: Standalone Binary**
  - [x] 5.1 `bun build --compile` → standalone `carlton` binary
  - [x] 5.2 Path resolution works in both dev and compiled mode
  - [x] 5.3 Default behavior: send briefing + start polling

## Key Decisions
- Google services stay READ-ONLY; email sending via Resend (separate API key)
- email.ts must never import google.ts — enforced by safety test
- PROMPT.md parsed by `## ` headings; accepts both "Delivery" and "Daily Briefing Delivery"
- Start with Resend sandbox (onboarding@resend.dev), upgrade domain later
- Reply detection via subject-line matching (searchThreads with subject filter)
- Carlton spawns `claude` interactively (not -p) so user can approve permissions, which save
- Git commits before every email send for debuggable history
- Replies stored as numbered pairs in reports/<date>/responses/

## Verified E2E
- `bun carlton send 2026-02-09` — briefing sent, git committed
- `bun carlton serve` / `./carlton` — polls, detects replies, spawns Claude
- Claude reads context, writes response, sends reply-to, logs memory
- Permissions pre-configured in settings.json for headless operation
