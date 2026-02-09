import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createQueue, type Queue, type Message } from "../src/queue.ts";
import { existsSync, rmSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";

describe("Queue", () => {
  let queue: Queue;
  let dbPath: string;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `carlton-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    dbPath = join(testDir, "data", "queue.db");
    mkdirSync(dirname(dbPath), { recursive: true });
  });

  afterEach(() => {
    if (queue) {
      queue.close();
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("createQueue", () => {
    it("creates database and tables", () => {
      queue = createQueue(dbPath);
      expect(existsSync(dbPath)).toBe(true);
    });
  });

  describe("submit", () => {
    it("creates a pending message", () => {
      queue = createQueue(dbPath);
      const msg = queue.submit("2026-02-09", "user@test.com", "Test Subject", "Test body");

      expect(msg.id).toMatch(/^msg_/);
      expect(msg.date).toBe("2026-02-09");
      expect(msg.from).toBe("user@test.com");
      expect(msg.subject).toBe("Test Subject");
      expect(msg.body).toBe("Test body");
      expect(msg.status).toBe("pending");
      expect(msg.agent_id).toBeNull();
    });

    it("stores reply message ID", () => {
      queue = createQueue(dbPath);
      const msg = queue.submit("2026-02-09", "user@test.com", "Test", "Body", "reply-123");

      expect(msg.reply_message_id).toBe("reply-123");
    });
  });

  describe("claim", () => {
    it("claims oldest pending message", () => {
      queue = createQueue(dbPath);
      queue.submit("2026-02-09", "user1@test.com", "First", "Body 1");
      // Small delay to ensure different timestamps
      queue.submit("2026-02-09", "user2@test.com", "Second", "Body 2");

      const claimed = queue.claim("agent_1");

      expect(claimed).not.toBeNull();
      expect(claimed!.from).toBe("user1@test.com");
      expect(claimed!.status).toBe("claimed");
      expect(claimed!.agent_id).toBe("agent_1");
    });

    it("returns null when no pending messages", () => {
      queue = createQueue(dbPath);

      const claimed = queue.claim("agent_1");

      expect(claimed).toBeNull();
    });

    it("does not claim already claimed messages", () => {
      queue = createQueue(dbPath);
      queue.submit("2026-02-09", "user@test.com", "Test", "Body");

      const first = queue.claim("agent_1");
      const second = queue.claim("agent_2");

      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });
  });

  describe("atomic claim (race condition prevention)", () => {
    it("prevents double-claiming with concurrent agents", async () => {
      queue = createQueue(dbPath);

      // Submit 3 messages
      queue.submit("2026-02-09", "user1@test.com", "Msg 1", "Body 1");
      queue.submit("2026-02-09", "user2@test.com", "Msg 2", "Body 2");
      queue.submit("2026-02-09", "user3@test.com", "Msg 3", "Body 3");

      // Simulate 5 concurrent agents trying to claim
      const claims = await Promise.all([
        Promise.resolve(queue.claim("agent_1")),
        Promise.resolve(queue.claim("agent_2")),
        Promise.resolve(queue.claim("agent_3")),
        Promise.resolve(queue.claim("agent_4")),
        Promise.resolve(queue.claim("agent_5")),
      ]);

      // Only 3 should succeed (one per message)
      const successful = claims.filter((c) => c !== null);
      expect(successful.length).toBe(3);

      // Each claimed message should have a different ID
      const ids = successful.map((c) => c!.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });
  });

  describe("progress", () => {
    it("updates message status to processing", () => {
      queue = createQueue(dbPath);
      const msg = queue.submit("2026-02-09", "user@test.com", "Test", "Body");
      queue.claim("agent_1");

      queue.progress(msg.id, "calling LLM");

      const updated = queue.getMessage(msg.id);
      expect(updated!.status).toBe("processing");
      expect(updated!.agent_state).toBe("calling LLM");
    });
  });

  describe("complete", () => {
    it("updates message status to completed", () => {
      queue = createQueue(dbPath);
      const msg = queue.submit("2026-02-09", "user@test.com", "Test", "Body");
      queue.claim("agent_1");

      queue.complete(msg.id, "Email sent successfully");

      const updated = queue.getMessage(msg.id);
      expect(updated!.status).toBe("completed");
      expect(updated!.result).toBe("Email sent successfully");
    });
  });

  describe("fail", () => {
    it("updates message status to failed", () => {
      queue = createQueue(dbPath);
      const msg = queue.submit("2026-02-09", "user@test.com", "Test", "Body");
      queue.claim("agent_1");

      queue.fail(msg.id, "Network error");

      const updated = queue.getMessage(msg.id);
      expect(updated!.status).toBe("failed");
      expect(updated!.error).toBe("Network error");
    });
  });

  describe("heartbeat", () => {
    it("registers an agent", () => {
      queue = createQueue(dbPath);

      queue.heartbeat("agent_1", null);

      const agents = queue.getActiveAgents();
      expect(agents.length).toBe(1);
      expect(agents[0].id).toBe("agent_1");
    });

    it("updates agent's active message", () => {
      queue = createQueue(dbPath);
      const msg = queue.submit("2026-02-09", "user@test.com", "Test", "Body");

      queue.heartbeat("agent_1", msg.id);

      const agents = queue.getActiveAgents();
      expect(agents[0].active_message_id).toBe(msg.id);
    });
  });

  describe("stale agent recovery", () => {
    it("reclaims messages from stale agents", () => {
      // Create database with stale data directly
      const db = new Database(dbPath);
      db.exec("PRAGMA journal_mode = WAL");

      // Create tables
      db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          "from" TEXT NOT NULL,
          subject TEXT NOT NULL,
          body TEXT NOT NULL,
          reply_message_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
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
      `);

      // Insert a message claimed by a stale agent (heartbeat 1 hour ago)
      const staleTime = Date.now() - 60 * 60 * 1000;
      db.prepare(`INSERT INTO agents (id, active_message_id, last_heartbeat) VALUES (?, ?, ?)`).run(
        "stale_agent",
        "msg_stale",
        staleTime
      );
      db.prepare(
        `INSERT INTO messages (id, date, "from", subject, body, status, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run("msg_stale", "2026-02-09", "user@test.com", "Test", "Body", "claimed", "stale_agent", staleTime, staleTime);

      db.close();

      // Now use the queue - claim should reclaim the stale message
      queue = createQueue(dbPath);
      const claimed = queue.claim("new_agent");

      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe("msg_stale");
      expect(claimed!.agent_id).toBe("new_agent");
    });
  });

  describe("getMessages", () => {
    it("returns messages for a specific date", () => {
      queue = createQueue(dbPath);
      queue.submit("2026-02-09", "user1@test.com", "Msg 1", "Body 1");
      queue.submit("2026-02-09", "user2@test.com", "Msg 2", "Body 2");
      queue.submit("2026-02-10", "user3@test.com", "Msg 3", "Body 3");

      const msgs = queue.getMessages("2026-02-09");

      expect(msgs.length).toBe(2);
      expect(msgs[0].from).toBe("user1@test.com");
      expect(msgs[1].from).toBe("user2@test.com");
    });
  });
});
