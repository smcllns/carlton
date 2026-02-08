# RFC: Agent Memory via Directory (v1)

**Status:** Draft — not yet approved for implementation
**Supersedes:** `docs/rfc-memory-log-compress-inject.md` (on `memory-rfc` branch)
**Date:** 2026-02-07

## Problem

Agents share a single `reports/memory.txt`. Only one agent can write at a time, there's no structure, and research agents have no memory access. The previous RFC overscoped it by coupling to Carlton-specific architecture. This RFC is a brutally simple v1.

## Design

Agents write individual files to a top-level `memory/` directory. No shared file, no coordination, no contention.

### Naming convention

```
memory/YYYY-MM-DD-agenttype-descriptive-slug.md
```

Agent types: `research`, `curator`, `reply`, `interactive`

### Examples

```
memory/2026-02-07-reply-user-prefers-short-briefings-joke-first.md
memory/2026-02-07-research-acme-corp-series-b-board-context.md
memory/2026-02-08-curator-skip-empty-research-gracefully.md
memory/2026-02-08-interactive-gccli-requires-z-suffix-for-utc.md
```

### How agents use it

1. **On startup:** agent receives sorted `ls memory/` filenames in prompt
2. **During work:** agent can `Read(memory/*)` any file whose title looks relevant
3. **On completion:** agent writes file(s) for substantive learnings — descriptive filename, rich content

### What goes in a file

- User preferences discovered during session
- Research findings (people, companies, context)
- Technical gotchas encountered
- Decisions made and why

### What does NOT go in a file

- Mechanical acks ("reply loop works") — if nothing substantive, don't write
- Duplicates of existing memory files

### Why filename-as-index works

- `ls memory/ | grep "curator"` → all curator learnings
- `ls memory/ | grep "2026-02-07"` → everything from today
- Agent scans titles, reads only what's relevant — no need to load everything
- Scales indefinitely (eventually fragment into vectors/embeddings, but not yet)

## Changes

### 1. `src/config.ts`
- `getMemoryFile()` → `getMemoryDir()` + `listMemoryTitles()`
- Ensure `memory/` created if missing

### 2. `src/curator.ts`
- Replace embedding full memory.txt with listing memory filenames
- Add `Read(memory/**)` to allowedTools
- Instruct: "Scan memory titles. Read files relevant to today's meetings."

### 3. `src/reply.ts`
- Inject memory titles listing into context
- Add `Read(memory/**),Write(memory/**)` to allowedTools
- Instruct: write to `memory/YYYY-MM-DD-reply-descriptive-slug.md`
- Remove "append to memory.txt" instructions

### 4. `src/research.ts`
- Inject memory titles into prompt
- Add `Read(memory/**),Write(memory/**)` to allowedTools
- Instruct: write to `memory/YYYY-MM-DD-research-descriptive-slug.md`

### 5. `.claude/hooks/stop-memory-prompt.sh`
- Target `memory/YYYY-MM-DD-interactive-descriptive-slug.md`

### 6. `CLAUDE.md`
- Update Memory section with new pattern

### 7. `src/index.ts`
- `cmdReset` clears `memory/` instead of `reports/memory.txt`

### 8. Migration
- Seed `memory/` from current `reports/memory.txt` entries
- Delete `reports/memory.txt`

## Verification

1. `bun test` passes (update config tests)
2. `bun carlton send <date>` — curator receives memory titles, can read files
3. Reply agent writes to `memory/YYYY-MM-DD-reply-*.md`
4. `ls memory/` shows correctly named files
5. Stop hook prompts new format

## Open questions

- Should we cap memory dir size or add a pruning mechanism, or just let it grow for now?
- Should curator inject full contents of all memory files, or just titles + selective read? (RFC assumes titles + selective read)
