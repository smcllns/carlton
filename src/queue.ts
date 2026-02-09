/**
 * SQLite-backed queue system for agent processing.
 *
 * Provides:
 * - ACID-guaranteed message claiming (no race conditions)
 * - Multiple concurrent agents
 * - Automatic dead agent recovery via heartbeats
 * - Human-readable thread.md derived from SQLite state
 */

import { Database } from "bun:sqlite";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { getReportsDir } from "./config.ts";

export type MessageStatus = "pending" | "claimed" | "processing" | "completed" | "failed";

export interface Message {
  id: string;
  date: string;
  from: string;
  subject: string;
  body: string;
  reply_message_id: string | null;
  status: MessageStatus;
  agent_id: string | null;
  agent_state: string | null;
  result: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface Agent {
  id: string;
  active_message_id: string | null;
  last_heartbeat: number;
}

const HEARTBEAT_TIMEOUT_MS = 30_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    "from" TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    reply_message_id TEXT,
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
CREATE INDEX IF NOT EXISTS idx_date ON messages(date);
`;

export interface Queue {
  submit: (date: string, from: string, subject: string, body: string, replyMessageId?: string) => Message;
  claim: (agentId: string) => Message | null;
  progress: (id: string, state: string) => void;
  complete: (id: string, result: string) => void;
  fail: (id: string, error: string) => void;
  heartbeat: (agentId: string, activeId: string | null) => void;
  getMessage: (id: string) => Message | null;
  getMessages: (date: string) => Message[];
  getActiveAgents: () => Agent[];
  close: () => void;
}

export function createQueue(dbPath: string): Queue {
  // Ensure data directory exists
  const dataDir = dirname(dbPath);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);

  // Prepared statements
  const insertMessage = db.prepare(`
    INSERT INTO messages (id, date, "from", subject, body, reply_message_id, status, created_at, updated_at)
    VALUES ($id, $date, $from, $subject, $body, $reply_message_id, 'pending', $now, $now)
  `);

  const reclaimStale = db.prepare(`
    UPDATE messages SET status = 'pending', agent_id = NULL, updated_at = $now
    WHERE status IN ('claimed', 'processing')
    AND agent_id IN (SELECT id FROM agents WHERE last_heartbeat < $threshold)
  `);

  const claimMessage = db.prepare(`
    UPDATE messages SET status = 'claimed', agent_id = $agent_id, updated_at = $now
    WHERE id = (SELECT id FROM messages WHERE status = 'pending' ORDER BY created_at LIMIT 1)
    RETURNING *
  `);

  const updateProgress = db.prepare(`
    UPDATE messages SET status = 'processing', agent_state = $state, updated_at = $now
    WHERE id = $id
  `);

  const updateComplete = db.prepare(`
    UPDATE messages SET status = 'completed', result = $result, updated_at = $now
    WHERE id = $id
  `);

  const updateFail = db.prepare(`
    UPDATE messages SET status = 'failed', error = $error, updated_at = $now
    WHERE id = $id
  `);

  const upsertAgent = db.prepare(`
    INSERT INTO agents (id, active_message_id, last_heartbeat)
    VALUES ($id, $active_message_id, $now)
    ON CONFLICT(id) DO UPDATE SET active_message_id = excluded.active_message_id, last_heartbeat = excluded.last_heartbeat
  `);

  const selectMessage = db.prepare(`SELECT * FROM messages WHERE id = $id`);
  const selectMessagesByDate = db.prepare(`SELECT * FROM messages WHERE date = $date ORDER BY created_at`);
  const selectActiveAgents = db.prepare(`SELECT * FROM agents WHERE last_heartbeat > $threshold`);

  // Generate unique message ID
  function generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // Sync thread.md after any state change
  function syncThreadMd(date: string) {
    const messages = selectMessagesByDate.all({ $date: date }) as Message[];
    const agents = selectActiveAgents.all({ $threshold: Date.now() - HEARTBEAT_TIMEOUT_MS }) as Agent[];

    const dateDir = join(getReportsDir(), date);
    if (!existsSync(dateDir)) {
      mkdirSync(dateDir, { recursive: true });
    }

    const threadFile = join(dateDir, "thread.md");
    const content = formatThreadMd(date, messages, agents);
    writeFileSync(threadFile, content, "utf8");
  }

  return {
    submit(date: string, from: string, subject: string, body: string, replyMessageId?: string): Message {
      const id = generateId();
      const now = Date.now();
      insertMessage.run({
        $id: id,
        $date: date,
        $from: from,
        $subject: subject,
        $body: body,
        $reply_message_id: replyMessageId || null,
        $now: now,
      });
      const msg = selectMessage.get({ $id: id }) as Message;
      syncThreadMd(date);
      return msg;
    },

    claim(agentId: string): Message | null {
      const now = Date.now();
      const staleThreshold = now - HEARTBEAT_TIMEOUT_MS;

      // Reclaim messages from stale agents
      reclaimStale.run({ $now: now, $threshold: staleThreshold });

      // Atomically claim the oldest pending message
      const msg = claimMessage.get({ $agent_id: agentId, $now: now }) as Message | undefined;
      if (msg) {
        syncThreadMd(msg.date);
        return msg;
      }
      return null;
    },

    progress(id: string, state: string): void {
      const now = Date.now();
      updateProgress.run({ $id: id, $state: state, $now: now });
      const msg = selectMessage.get({ $id: id }) as Message | undefined;
      if (msg) {
        syncThreadMd(msg.date);
      }
    },

    complete(id: string, result: string): void {
      const now = Date.now();
      updateComplete.run({ $id: id, $result: result, $now: now });
      const msg = selectMessage.get({ $id: id }) as Message | undefined;
      if (msg) {
        syncThreadMd(msg.date);
      }
    },

    fail(id: string, error: string): void {
      const now = Date.now();
      updateFail.run({ $id: id, $error: error, $now: now });
      const msg = selectMessage.get({ $id: id }) as Message | undefined;
      if (msg) {
        syncThreadMd(msg.date);
      }
    },

    heartbeat(agentId: string, activeId: string | null): void {
      upsertAgent.run({ $id: agentId, $active_message_id: activeId, $now: Date.now() });
    },

    getMessage(id: string): Message | null {
      return (selectMessage.get({ $id: id }) as Message) || null;
    },

    getMessages(date: string): Message[] {
      return selectMessagesByDate.all({ $date: date }) as Message[];
    },

    getActiveAgents(): Agent[] {
      return selectActiveAgents.all({ $threshold: Date.now() - HEARTBEAT_TIMEOUT_MS }) as Agent[];
    },

    close(): void {
      db.close();
    },
  };
}

/**
 * Format thread.md from queue state.
 */
function formatThreadMd(date: string, messages: Message[], agents: Agent[]): string {
  const now = new Date().toISOString();
  let md = `# Queue · ${date}\n\n`;

  // Active agents section
  if (agents.length > 0) {
    md += `## Agents\n`;
    for (const agent of agents) {
      const activeMsg = agent.active_message_id || "(idle)";
      md += `- **${agent.id}** → ${activeMsg}\n`;
    }
    md += `\n`;
  }

  // Messages section
  md += `## Messages\n\n`;

  if (messages.length === 0) {
    md += `_No messages yet._\n`;
    return md;
  }

  for (const msg of messages) {
    const icon = statusIcon(msg.status);
    const timestamp = new Date(msg.created_at).toISOString();

    md += `### ${icon} ${msg.id}\n`;
    md += `${msg.status}`;
    if (msg.agent_state) {
      md += ` · ${msg.agent_state}`;
    }
    md += `\n`;
    md += `**From:** ${msg.from}\n`;
    md += `**Subject:** ${msg.subject}\n`;
    md += `**Received:** ${timestamp}\n`;
    md += `\`\`\`\n${msg.body.slice(0, 500)}${msg.body.length > 500 ? "..." : ""}\n\`\`\`\n`;

    if (msg.result) {
      md += `**Result:** ${msg.result}\n`;
    }
    if (msg.error) {
      md += `**Error:** ${msg.error}\n`;
    }
    md += `\n`;
  }

  md += `---\n_Updated: ${now}_\n`;
  return md;
}

function statusIcon(status: MessageStatus): string {
  switch (status) {
    case "pending":
      return "⏳";
    case "claimed":
      return "🔒";
    case "processing":
      return "⚙️";
    case "completed":
      return "✅";
    case "failed":
      return "❌";
    default:
      return "❓";
  }
}
