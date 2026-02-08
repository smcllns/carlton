# Loops: A Framework for Agent-Human Feedback Cycles

Every agent loop has the same basic shape:

**trigger → agent work → delivery → human response → (repeat)**

Carlton, Murphy, Eva — each is a different instantiation of this pattern. This doc captures the framework for thinking about loops: what differentiates them, what makes them valuable, and where the biggest gaps are.

## The Four Dimensions

### 1. Initiative — who drives the loop?

There's a maturity gradient:

| Level | Who notices? | Example | Cognitive load on human |
|-------|-------------|---------|------------------------|
| **Human-driven** | Human opens terminal, asks a question | CLI session | High — must remember to ask |
| **Event-driven** | Something happens, agent processes it | Murphy cron, WhatsApp poll | Medium — must set up triggers |
| **Agent-driven** | Agent decides something needs attention | Carlton briefings | Low — agent carries the burden of noticing |

The biggest unlock is the shift from human-driven to agent-driven. Most people use LLMs in human-driven mode (chatbot). Agent-driven loops offload the *remembering* — which is where things fall through cracks.

### 2. Channel — where does the loop meet you?

- **Terminal** — requires context-switching into "work mode"
- **Email** — ambient, already checked regularly, supports threading
- **WhatsApp** — ambient, immediate, conversational
- **In-vault** — Obsidian notes, journal injection, #claude tags

The channel determines whether the loop is a tool you use or a presence that works alongside you. The best channel is whichever one you're already looking at for that type of decision.

### 3. Memory — does the loop compound?

- **Stateless**: Each cycle is independent. (Daily email summary — useful but today doesn't learn from yesterday.)
- **Stateful**: Cycles build on each other within a session. (Carlton thread history — replies carry context forward.)
- **Adaptive**: The loop changes *itself* over time. (log-learning → updated instructions → different behavior next run.)

Value compounds: stateless < stateful < adaptive. The most powerful loops are adaptive — each cycle makes the next one smarter.

### 4. Cadence — how tight is the feedback cycle?

| Cadence | Examples | Good for |
|---------|----------|----------|
| Seconds | Terminal sessions | Exploration, debugging |
| Minutes | WhatsApp replies | Quick decisions, status checks |
| Hours | Email briefings | Meeting prep, daily planning |
| Days/Weeks | Weekly reviews, goal tracking | Accountability, strategy |

Tighter isn't always better — too tight becomes interruption. Match cadence to decision speed. Meeting prep wants hours of lead time. Goal accountability wants weekly.

## Current Loops (Feb 2026)

| Loop | Initiative | Channel | Memory | Cadence |
|------|-----------|---------|--------|---------|
| CLI sessions | Human-driven | Terminal | Stateless | On-demand |
| Murphy cron | Event-driven | Terminal/WhatsApp | Stateless | Scheduled |
| Murphy WhatsApp poll | Event-driven | WhatsApp | Stateful (conv history) | Minutes |
| Carlton briefings | Agent-driven | Email | Stateful (thread history) | Scheduled |
| Daily journal (`/today`, `/eod`) | Human-driven | In-vault | Stateless | Daily |
| Learning system | Human-driven | In-vault/CLI | Adaptive | On correction |

## Highest-Value Gaps

Scored by the value heuristic: agent-initiated + channel-native + stateful/adaptive + right cadence.

**1. Accountability/follow-up loop** — catches dropped balls, resurfaces deferred commitments. Should be agent-driven (notices things slipping), channel-native (WhatsApp or journal injection), stateful (knows what was deferred and how many times), weekly-cadenced. This is the biggest gap because the failure mode — things silently rolling forward week after week — is invisible until guilt accumulates.

**2. Review/approval loop** — agents produce work (PRs, drafts, research), getting human feedback back in is high-friction. Carlton's pattern (deliver via channel, iterate via reply) applied to code review and task approval. The Three Checkpoints workflow already describes this — it needs a channel.

**3. Inbox triage loop** — items accumulate, filing is manual. Agent-driven proposals via WhatsApp ("file X to Y?"), human confirms with a reply.

## The Meta-Observation

These aren't separate tools — they're applications on a shared infrastructure:

- **Murphy** = the scheduler and dispatcher
- **WhatsApp / Email** = the channels
- **Learning system** = the adaptive layer
- **Each loop** = an application plugging into that infrastructure

The question "what loop to build next?" is really: **what decisions/tasks should shift from human-driven to agent-driven?** The answer is usually: whatever you feel guilty about dropping.
