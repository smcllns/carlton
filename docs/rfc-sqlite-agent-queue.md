# RFC: SQLite Agent Queue

**Status:** Proposal
**Date:** 2026-02-09

---

## Summary

Replace the current lock-based serve loop with a SQLite-backed queue that provides:

- ACID-guaranteed message claiming (no race conditions)
- Multiple concurrent agents
- Automatic dead agent recovery via heartbeats
- Human-readable `thread.md` derived from SQLite state

---

## Motivation

The current architecture uses a lock-based approach:

```typescript
let isProcessing = false;

if (isProcessing) return; // skip if busy
isProcessing = true;
// ... process ...
isProcessing = false;
```

This works for a single agent but has limitations:

| Issue | Impact |
|-------|--------|
| Single agent only | Can't parallelize during busy periods |
| No queue | Work arriving during processing depends on next poll |
| Implicit state | "What's happening?" requires checking if process is running |
| Crash recovery | Manual intervention needed |

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     SQLite (queue.db)                        │
│  ┌─────────────┐  ┌─────────────┐                           │
│  │  messages   │  │   agents    │                           │
│  │             │  │             │                           │
│  │ id          │  │ id          │                           │
│  │ content     │  │ active_id   │                           │
│  │ status      │  │ last_seen   │                           │
│  │ agent_id    │  │             │                           │
│  └─────────────┘  └─────────────┘                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ derive (on state change)
                            ▼
                    ┌───────────────┐
                    │  thread.md    │
                    │               │
                    │ Human-readable│
                    │ queue status  │
                    └───────────────┘
```

---

## Schema

```sql
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'claimed', 'processing', 'completed', 'failed')),
    agent_id TEXT,
    agent_state TEXT,
    result TEXT,
    error TEXT,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    active_message_id TEXT,
    last_heartbeat INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_status ON messages(status);
```

---

## Core Implementation

```typescript
// src/queue.ts (~80 lines)

import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';

const HEARTBEAT_TIMEOUT_MS = 30_000;

export function createQueue(dbPath: string) {
  const db = Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  // ... schema init ...

  const reclaimStale = db.prepare(`
    UPDATE messages SET status = 'pending', agent_id = NULL
    WHERE status IN ('claimed','processing')
    AND agent_id IN (SELECT id FROM agents WHERE last_heartbeat < unixepoch()*1000 - ?)
  `);

  const claim = db.prepare(`
    UPDATE messages SET status = 'claimed', agent_id = ?
    WHERE id = (SELECT id FROM messages WHERE status = 'pending' ORDER BY created_at LIMIT 1)
    RETURNING *
  `);

  return {
    submit: (content: string) => { /* insert + sync */ },
    claim: (agentId: string) => { reclaimStale.run(HEARTBEAT_TIMEOUT_MS); return claim.get(agentId); },
    progress: (id: string, state: string) => { /* update + sync */ },
    complete: (id: string, result: string) => { /* update + sync */ },
    fail: (id: string, error: string) => { /* update + sync */ },
    heartbeat: (agentId: string, activeId: string | null) => { /* upsert */ },
  };
}
```

### The Magic: Atomic Claim

```sql
UPDATE messages SET status = 'claimed', agent_id = ?
WHERE id = (SELECT id FROM messages WHERE status = 'pending' ORDER BY created_at LIMIT 1)
RETURNING *
```

One statement: find oldest pending → claim it → return it. **No race condition possible.**

---

## Agent Loop

```typescript
// src/index.ts

const queue = createQueue('./data/queue.db');
const AGENT_ID = `agent_${process.pid}`;

setInterval(() => queue.heartbeat(AGENT_ID, currentId), 10_000);

while (true) {
  const msg = queue.claim(AGENT_ID);

  if (msg) {
    try {
      queue.progress(msg.id, 'processing');
      const result = await processEmail(msg.content);
      queue.complete(msg.id, result);
    } catch (e) {
      queue.fail(msg.id, String(e));
    }
  }

  await sleep(5000);
}
```

---

## Derived thread.md

Every state change regenerates `thread.md`:

```markdown
# Queue · 2026-02-09T14:32:01.000Z

## Agents
- **agent_12345** → msg_1707494521 (processing)

## Messages

### ⚙️ msg_1707494521
processing · calling LLM
```
Process this email from John about the quarterly report
```

### ✅ msg_1707494400
completed
```
Summarize yesterday's meeting
```
**Result:** Summary sent via email
```

---

## File Structure

```
carlton/
├── src/
│   ├── queue.ts              # ~80 lines - queue system
│   ├── index.ts              # Entry point (modified)
│   ├── serve.ts              # Serve loop (simplified or removed)
│   └── ...                   # Existing files
├── data/
│   ├── queue.db              # SQLite (source of truth)
│   ├── queue.db-wal          # Write-ahead log
│   └── thread.md             # Human-readable mirror
├── package.json              # Add: better-sqlite3
└── ...
```

---

## Comparison

| | Current (Lock-based) | Proposed (SQLite) |
|---|---|---|
| Concurrency | Single agent | N agents |
| Race conditions | N/A (single) | Impossible (ACID) |
| Queue | Implicit | Explicit |
| Crash recovery | Manual | Automatic (heartbeat) |
| State visibility | Check process | `cat thread.md` or SQL |
| Dependencies | None | +1 (better-sqlite3) |
| New code | — | ~80 lines |

---

## Reliability Guarantees

| Property | How |
|----------|-----|
| Atomicity | SQLite transactions |
| No double-processing | Atomic claim statement |
| Crash recovery | WAL mode + heartbeat timeout |
| Concurrent agents | `busy_timeout` handles lock contention |

---

## Scaling Path

1. **Now:** SQLite, single machine, 1-3 agents
2. **Later:** Swap to Postgres if multi-server needed (same SQL, different driver)
3. **Much later:** Swap to Redis/SQS if needed (same interface)

---

## Implementation Plan

1. Add `better-sqlite3` dependency
2. Create `src/queue.ts` with schema + prepared statements
3. Modify `src/index.ts` to use queue instead of lock
4. Update email ingestion to call `queue.submit()`
5. Add heartbeat interval
6. Add `thread.md` sync on state changes
7. Update tests

---

## Decision

**Approve this RFC to proceed with implementation.**

Trade-off: ~80 lines of new code + 1 dependency for:
- Multi-agent support
- Automatic crash recovery
- Explicit, queryable state
- Human-readable derived output
