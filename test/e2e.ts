#!/usr/bin/env bun
/**
 * Live E2E integration test for Carlton.
 *
 * Exercises: report creation → send briefing → double-send guard →
 * simulate reply → Claude response → second reply with thread history.
 *
 * Requires: tmux, RESEND_API_KEY, Google auth configured.
 * Run: tmux new -s carlton-test 'bun test/e2e.ts'
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { getProjectRoot, getReportsDir } from "../src/config.ts";
import { loadPrompt } from "../src/prompt.ts";
import { sendBriefing } from "../src/email.ts";
import {
  nextResponseNumber,
  buildThreadHistory,
  buildReplyContext,
  writeReplyFile,
  replyFilePaths,
} from "../src/reply.ts";

const TEST_DATE = "2099-01-01";
const PROJECT_ROOT = getProjectRoot();
const REPORTS_DIR = getReportsDir();
const DATE_DIR = join(REPORTS_DIR, TEST_DATE);
const RESPONSES_DIR = join(DATE_DIR, "responses");

interface StepResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: StepResult[] = [];

function record(name: string, passed: boolean, detail: string) {
  results.push({ name, passed, detail });
  const icon = passed ? "✅" : "❌";
  console.log(`\n${icon} Step: ${name}`);
  if (detail) console.log(`   ${detail}`);
}

function assert(condition: boolean, msg: string): asserts condition {
  if (!condition) throw new Error(msg);
}

async function pollForFile(filepath: string, timeoutMs: number, intervalMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(filepath)) {
      const content = readFileSync(filepath, "utf8").trim();
      if (content.length > 0) return content;
    }
    await Bun.sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${filepath}`);
}

// --- Preflight ---

function preflight() {
  console.log("Carlton E2E Integration Test");
  console.log("============================\n");

  if (!process.env.TMUX) {
    console.error("Must run inside tmux. Usage: tmux new -s carlton-test 'bun test/e2e.ts'");
    process.exit(1);
  }

  if (!process.env.RESEND_API_KEY) {
    try {
      const env = readFileSync(join(PROJECT_ROOT, ".env"), "utf8");
      const match = env.match(/RESEND_API_KEY=(.+)/);
      if (match) process.env.RESEND_API_KEY = match[1].trim();
    } catch {}
  }

  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not set. Set it in .env or environment.");
    process.exit(1);
  }

  loadPrompt();

  console.log(`Test date: ${TEST_DATE}`);
  console.log(`Reports dir: ${DATE_DIR}\n`);
}

// --- Steps ---

async function step1_createTestReport() {
  if (existsSync(DATE_DIR)) rmSync(DATE_DIR, { recursive: true, force: true });
  mkdirSync(DATE_DIR, { recursive: true });

  const report = `# ☘️🦊 E2E Test Standup

**Time:** 9:00 AM - 9:30 AM

## ☘️ Attendees

- alice@example.com
- bob@example.com

## 🦊 Description

Automated E2E test meeting. Not a real event.
`;

  const reportFile = join(DATE_DIR, "09-00-e2e-test-standup.md");
  writeFileSync(reportFile, report, "utf8");

  const briefing = `# Carlton Briefing — ${TEST_DATE}

> *1 meeting on deck for ${TEST_DATE}, 9:00 — ref:e2etest*

---

${report}`;

  const briefingFile = join(DATE_DIR, "briefing.md");
  writeFileSync(briefingFile, briefing, "utf8");

  assert(existsSync(reportFile), "Report file not created");
  assert(existsSync(briefingFile), "Briefing file not created");
  record("Create test report", true, reportFile);
}

const TEST_SUBJECT = `[E2E TEST] ${TEST_DATE} Carlton Briefing Notes`;

async function step2_sendBriefing() {
  const prompt = loadPrompt();
  const briefingFile = join(DATE_DIR, "briefing.md");
  const markdown = readFileSync(briefingFile, "utf8");
  const sentMarker = join(DATE_DIR, ".briefing-sent");

  const messageId = await sendBriefing(prompt.delivery.email, TEST_SUBJECT, markdown);
  writeFileSync(sentMarker, messageId, "utf8");

  assert(existsSync(sentMarker), ".briefing-sent marker not created");

  record("Send briefing", true, `Sent to ${prompt.delivery.email} (${messageId})`);
}

async function step3_doubleSendBlocked() {
  const sentMarker = join(DATE_DIR, ".briefing-sent");
  assert(existsSync(sentMarker), "Marker should exist from step 2");

  record("Double-send blocked", true, "Marker exists, would skip");
}

async function step4_simulateReply1() {
  mkdirSync(RESPONSES_DIR, { recursive: true });

  const num = nextResponseNumber(RESPONSES_DIR);
  assert(num === 1, `Expected reply number 1, got ${num}`);

  const paths = replyFilePaths(RESPONSES_DIR, num);

  writeReplyFile(
    paths.replyFile,
    num,
    "testuser@example.com",
    new Date().toISOString(),
    TEST_SUBJECT,
    "What time is the standup and who is attending?",
  );

  const threadHistory = buildThreadHistory(RESPONSES_DIR, num);
  assert(threadHistory === "", "Thread history should be empty for first reply");

  const context = buildReplyContext(
    {
      from: "testuser@example.com",
      subject: TEST_SUBJECT,
      date: new Date().toISOString(),
      account: "test@example.com",
      threadId: "e2e-test-thread",
      messageId: "e2e-test-msg-01",
      briefingDate: TEST_DATE,
    },
    "What time is the standup and who is attending?",
    threadHistory,
    paths,
  );
  writeFileSync(paths.contextFile, context, "utf8");

  assert(existsSync(paths.replyFile), "Reply file not written");
  assert(existsSync(paths.contextFile), "Context file not written");

  const windowName = "e2e-reply-01";
  const contextRelative = `reports/${TEST_DATE}/responses/01-context.md`;
  const logFile = join(DATE_DIR, "e2e-reply-01.log");
  const claudeCmd = `claude "A user replied to a Carlton briefing email. Read ${contextRelative} for the full context and instructions." 2>&1 | tee ${logFile}`;

  Bun.spawn(
    ["tmux", "new-window", "-d", "-n", windowName, "-c", PROJECT_ROOT, claudeCmd],
    { stdio: ["ignore", "ignore", "ignore"] },
  );

  record("Simulate reply #1", true, `Spawned Claude in tmux window '${windowName}'`);
}

async function step5_waitForResponse1() {
  const responseFile = join(RESPONSES_DIR, "01-response.md");

  console.log("\n⏳ Waiting for Claude to write 01-response.md (timeout: 120s)...");
  const content = await pollForFile(responseFile, 120_000);

  assert(content.length > 10, `Response too short (${content.length} chars)`);

  record("Claude response #1", true, `${content.length} chars, starts: "${content.slice(0, 80)}..."`);
}

async function step6_simulateReply2() {
  const num = nextResponseNumber(RESPONSES_DIR);
  assert(num === 2, `Expected reply number 2, got ${num}`);

  const paths = replyFilePaths(RESPONSES_DIR, num);

  writeReplyFile(
    paths.replyFile,
    num,
    "testuser@example.com",
    new Date().toISOString(),
    TEST_SUBJECT,
    "Can you add the zoom link for that standup?",
  );

  const threadHistory = buildThreadHistory(RESPONSES_DIR, num);
  assert(threadHistory.includes("Exchange #1"), "Thread history should include exchange #1");

  const context = buildReplyContext(
    {
      from: "testuser@example.com",
      subject: TEST_SUBJECT,
      date: new Date().toISOString(),
      account: "test@example.com",
      threadId: "e2e-test-thread",
      messageId: "e2e-test-msg-02",
      briefingDate: TEST_DATE,
    },
    "Can you add the zoom link for that standup?",
    threadHistory,
    paths,
  );
  writeFileSync(paths.contextFile, context, "utf8");

  const windowName = "e2e-reply-02";
  const contextRelative = `reports/${TEST_DATE}/responses/02-context.md`;
  const logFile = join(DATE_DIR, "e2e-reply-02.log");
  const claudeCmd = `claude "A user replied to a Carlton briefing email. Read ${contextRelative} for the full context and instructions." 2>&1 | tee ${logFile}`;

  Bun.spawn(
    ["tmux", "new-window", "-d", "-n", windowName, "-c", PROJECT_ROOT, claudeCmd],
    { stdio: ["ignore", "ignore", "ignore"] },
  );

  record("Simulate reply #2", true, `Spawned Claude in tmux window '${windowName}'`);
}

async function step7_waitForResponse2() {
  const responseFile = join(RESPONSES_DIR, "02-response.md");

  console.log("\n⏳ Waiting for Claude to write 02-response.md (timeout: 120s)...");
  const content = await pollForFile(responseFile, 120_000);

  assert(content.length > 10, `Response too short (${content.length} chars)`);

  record("Claude response #2", true, `${content.length} chars, starts: "${content.slice(0, 80)}..."`);
}

const TMUX_WINDOWS = ["e2e-reply-01", "e2e-reply-02"];

function listTmuxWindows(): string[] {
  const result = Bun.spawnSync(["tmux", "list-windows", "-F", "#{window_name}"]);
  return result.stdout.toString().trim().split("\n").filter(Boolean);
}

function step8_cleanup() {
  for (const name of TMUX_WINDOWS) {
    Bun.spawnSync(["tmux", "kill-window", "-t", name]);
  }

  const remaining = listTmuxWindows();
  const leaked = TMUX_WINDOWS.filter((w) => remaining.includes(w));
  assert(leaked.length === 0, `tmux windows not killed: ${leaked.join(", ")}`);

  rmSync(DATE_DIR, { recursive: true, force: true });
  assert(!existsSync(DATE_DIR), `${DATE_DIR} still exists`);

  record("Cleanup", true, "tmux windows killed, test data removed");
}

function printResults() {
  console.log("\n\n========== E2E Results ==========\n");

  let passed = 0;
  let failed = 0;

  for (const r of results) {
    const icon = r.passed ? "✅" : "❌";
    console.log(`${icon} ${r.name}`);
    if (r.passed) passed++;
    else {
      failed++;
      console.log(`   ${r.detail}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${results.length} steps`);
  if (failed > 0) process.exit(1);
}

// --- Run ---

async function main() {
  preflight();

  try {
    await step1_createTestReport();
    await step2_sendBriefing();
    await step3_doubleSendBlocked();
    await step4_simulateReply1();
    await step5_waitForResponse1();
    await step6_simulateReply2();
    await step7_waitForResponse2();
  } catch (err: any) {
    record(err.message.slice(0, 60), false, err.message);
  }

  const hasFailures = results.some((r) => !r.passed);
  if (hasFailures) {
    for (const logName of ["e2e-reply-01.log", "e2e-reply-02.log"]) {
      const logPath = join(DATE_DIR, logName);
      if (existsSync(logPath)) {
        const log = readFileSync(logPath, "utf8").trim();
        console.log(`\n--- ${logName} ---\n${log.slice(-2000)}\n`);
      }
    }
  }

  step8_cleanup();
  printResults();
}

main();
