/**
 * Agent loop - claims messages from queue and processes them.
 *
 * Each agent:
 * - Has a unique ID (based on PID)
 * - Sends heartbeats every 10 seconds
 * - Claims and processes messages one at a time
 * - Spawns Claude to generate responses
 */

import { openSync } from "fs";
import { join } from "path";
import { getProjectRoot, getReportsDir } from "./config.ts";
import { createQueue, type Queue, type Message } from "./queue.ts";
import { buildReplyPromptFromMessage } from "./reply.ts";

const AGENT_ID = `agent_${process.pid}`;
const HEARTBEAT_INTERVAL_MS = 10_000;
const POLL_INTERVAL_MS = 5_000;

export interface AgentOptions {
  dbPath?: string;
  spawnFn?: (date: string, messageId: string, prompt: string) => void;
  onMessage?: (msg: Message) => void;
  onComplete?: (msg: Message, result: string) => void;
  onError?: (msg: Message, error: string) => void;
}

let currentMessageId: string | null = null;

/**
 * Default spawn function - spawns Claude with the reply prompt.
 */
function defaultSpawnFn(date: string, messageId: string, prompt: string) {
  const projectRoot = getProjectRoot();
  const logDir = join(getReportsDir(), date, "responses");
  const logFile = join(logDir, `.claude-${messageId}.log`);
  const logFd = openSync(logFile, "w");
  const allowedTools = "Read(reports/**),Write(reports/**),Bash(bun carlton respond *)";
  console.log(`🤖 Spawning Claude for ${messageId}`);
  const proc = Bun.spawn(
    ["claude", "-p", "--model", "sonnet", "--allowedTools", allowedTools],
    { cwd: projectRoot, stdio: ["pipe", logFd, logFd] },
  );
  proc.stdin.write(prompt);
  proc.stdin.end();
}

/**
 * Start the agent loop.
 *
 * @param options - Configuration options
 * @returns Cleanup function to stop the agent
 */
export function startAgent(options: AgentOptions = {}): () => void {
  const dbPath = options.dbPath || join(getProjectRoot(), "data", "queue.db");
  const spawnFn = options.spawnFn || defaultSpawnFn;
  const queue = createQueue(dbPath);

  let running = true;
  let heartbeatTimer: ReturnType<typeof setInterval>;
  let pollTimer: ReturnType<typeof setTimeout>;

  // Heartbeat loop
  heartbeatTimer = setInterval(() => {
    if (running) {
      queue.heartbeat(AGENT_ID, currentMessageId);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Poll loop
  async function poll() {
    if (!running) return;

    try {
      const msg = queue.claim(AGENT_ID);

      if (msg) {
        currentMessageId = msg.id;
        options.onMessage?.(msg);

        try {
          queue.progress(msg.id, "spawning Claude");

          // Build prompt and spawn Claude
          const prompt = buildReplyPromptFromMessage(msg);
          spawnFn(msg.date, msg.id, prompt);

          // Note: We don't wait for Claude to finish here.
          // The respond command will call queue.complete() when done.
          // For now, we just mark it as processing and move on.
          queue.progress(msg.id, "Claude processing");
        } catch (err: any) {
          queue.fail(msg.id, err.message || String(err));
          options.onError?.(msg, err.message || String(err));
        }
      }
    } catch (err: any) {
      console.error(`Agent error: ${err.message}`);
    }

    currentMessageId = null;
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  }

  // Initial heartbeat
  queue.heartbeat(AGENT_ID, null);

  // Start polling
  poll();

  // Return cleanup function
  return () => {
    running = false;
    clearInterval(heartbeatTimer);
    clearTimeout(pollTimer);
    queue.close();
  };
}

/**
 * Get the current agent ID.
 */
export function getAgentId(): string {
  return AGENT_ID;
}
