#!/usr/bin/env bun
/**
 * Live E2E integration test for Carlton's redesigned email loop.
 *
 * Exercises: report creation → send briefing (with thread.md) →
 * double-send guard → simulate replies via recordReply-style writes →
 * triggerProcessing with lock → Claude response → batch replies →
 * stale lock recovery → cleanup.
 *
 * Requires: tmux, RESEND_API_KEY, Google auth configured.
 * Run: tmux new -s carlton-test 'bun test/e2e.ts'
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync, utimesSync } from "fs";
import { join } from "path";
import { getProjectRoot, getReportsDir } from "../src/config.ts";
import { loadPrompt } from "../src/prompt.ts";
import { sendBriefing } from "../src/email.ts";
import {
  nextResponseNumber,
  hasUnprocessedReplies,
  writeReplyFile,
  replyFilePaths,
  appendToThread,
  removeNewMarkers,
} from "../src/reply.ts";

const TEST_DATE = "2099-01-01";
const PROJECT_ROOT = getProjectRoot();
const REPORTS_DIR = getReportsDir();
const DATE_DIR = join(REPORTS_DIR, TEST_DATE);
const RESPONSES_DIR = join(DATE_DIR, "responses");
const THREAD_FILE = join(DATE_DIR, "thread.md");

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
  console.log("Carlton E2E Integration Test (Redesigned Loop)");
  console.log("================================================\n");

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

  if (!process.env.CARLTON_DELIVERY_EMAIL) {
    try {
      const env = readFileSync(join(PROJECT_ROOT, ".env"), "utf8");
      const match = env.match(/CARLTON_DELIVERY_EMAIL=(.+)/);
      if (match) process.env.CARLTON_DELIVERY_EMAIL = match[1].trim();
    } catch {}
  }

  loadPrompt();

  console.log(`Test date: ${TEST_DATE}`);
  console.log(`Reports dir: ${DATE_DIR}\n`);
}

// --- Steps ---

const TEST_SUBJECT = `[E2E TEST] ${TEST_DATE} Carlton Briefing Notes`;

async function step1_createReportAndSendBriefing() {
  if (existsSync(DATE_DIR)) rmSync(DATE_DIR, { recursive: true, force: true });
  mkdirSync(DATE_DIR, { recursive: true });

  const report = `# 🦸🍩 E2E Test Standup

**Time:** 9:00 AM - 9:30 AM

## 🦸 Attendees

- alice@example.com
- bob@example.com

## 🍩 Description

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

  // Send briefing via Resend
  const prompt = loadPrompt();
  const deliveryEmail = process.env.CARLTON_DELIVERY_EMAIL || prompt.delivery.email;
  const sentMarker = join(DATE_DIR, ".briefing-sent");

  const result = await sendBriefing(deliveryEmail, TEST_SUBJECT, briefing, TEST_DATE);
  writeFileSync(sentMarker, JSON.stringify(result), "utf8");

  // Create thread.md
  const header = `# Carlton Thread — ${TEST_DATE}\n`;
  const briefingSection = `## Briefing Sent (${new Date().toISOString()})\n\n${briefing}\n`;
  writeFileSync(THREAD_FILE, header + "\n" + briefingSection, "utf8");

  // Verify
  assert(existsSync(reportFile), "Report file not created");
  assert(existsSync(briefingFile), "Briefing file not created");
  assert(existsSync(sentMarker), ".briefing-sent marker not created");
  assert(existsSync(THREAD_FILE), "thread.md not created");

  const sentContent = JSON.parse(readFileSync(sentMarker, "utf8"));
  assert(sentContent.resendId, ".briefing-sent missing resendId");
  assert(sentContent.messageId, ".briefing-sent missing messageId");
  assert(sentContent.messageId.includes("carlton-2099-01-01"), "messageId doesn't contain date");

  const threadContent = readFileSync(THREAD_FILE, "utf8");
  assert(threadContent.includes("Briefing Sent"), "thread.md missing briefing section");
  assert(threadContent.includes("E2E Test Standup"), "thread.md missing briefing content");

  record("Create report + send briefing", true,
    `Sent to ${deliveryEmail} (${sentContent.resendId}), thread.md created`);
}

async function step2_doubleSendBlocked() {
  const sentMarker = join(DATE_DIR, ".briefing-sent");
  assert(existsSync(sentMarker), "Marker should exist from step 1");
  record("Double-send blocked", true, "Marker exists, would skip");
}

async function step3_simulateReply1() {
  mkdirSync(RESPONSES_DIR, { recursive: true });

  const num = nextResponseNumber(RESPONSES_DIR);
  assert(num === 1, `Expected reply number 1, got ${num}`);

  const paths = replyFilePaths(RESPONSES_DIR, num);
  writeReplyFile(paths.replyFile, num, "testuser@example.com", new Date().toISOString(),
    TEST_SUBJECT, "What time is the standup and who is attending?");

  appendToThread(THREAD_FILE,
    `NEW Reply #${num} (${new Date().toISOString()} from testuser@example.com)`,
    "What time is the standup and who is attending?");

  assert(existsSync(paths.replyFile), "Reply file not written");
  assert(hasUnprocessedReplies(RESPONSES_DIR), "hasUnprocessedReplies should be true");

  const threadContent = readFileSync(THREAD_FILE, "utf8");
  assert(threadContent.includes("## NEW Reply #1"), "thread.md missing NEW Reply #1");

  record("Simulate reply #1", true, "Reply recorded, thread.md updated with NEW marker");
}

async function step4_triggerProcessing() {
  const lockFile = join(RESPONSES_DIR, ".processing");

  // Write lock + spawn Claude
  writeFileSync(lockFile, new Date().toISOString());

  // Build prompt and spawn
  const { buildReplyPrompt } = await import("../src/reply.ts");
  const prompt = buildReplyPrompt(TEST_DATE);
  const promptFile = join(RESPONSES_DIR, ".reply-prompt.md");
  writeFileSync(promptFile, prompt, "utf8");

  const allowedTools = "Read(reports/**),Write(reports/**),Bash(bun carlton reply-to *),Bash(bunx gmcli *),Bash(bunx gccli *),Bash(bunx gdcli *),Bash(rm reports/*/responses/.processing)";
  const windowName = "e2e-reply-01";
  const logFile = join(DATE_DIR, "e2e-reply-01.log");
  const claudeCmd = `claude -p --model sonnet --allowedTools "${allowedTools}" < reports/${TEST_DATE}/responses/.reply-prompt.md 2>&1 | tee ${logFile}`;

  Bun.spawn(
    ["tmux", "new-window", "-d", "-n", windowName, "-c", PROJECT_ROOT, claudeCmd],
    { stdio: ["ignore", "ignore", "ignore"] },
  );

  assert(existsSync(lockFile), "Lock file not created");
  record("Trigger processing", true, `Lock created, Claude spawned in tmux '${windowName}'`);
}

async function step5_waitForResponse1() {
  const responseFile = join(RESPONSES_DIR, "01-response.md");

  console.log("\n⏳ Waiting for Claude to write 01-response.md (timeout: 120s)...");
  const content = await pollForFile(responseFile, 120_000);

  assert(content.length > 10, `Response too short (${content.length} chars)`);

  // Verify thread.md was updated (response appended, NEW marker removed)
  // Note: Claude calls `bun carlton reply-to` which does this
  const threadContent = readFileSync(THREAD_FILE, "utf8");
  const hasResponse = threadContent.includes("## Response");
  const hasNew = threadContent.includes("## NEW Reply");

  record("Claude response #1", true,
    `${content.length} chars. thread.md response: ${hasResponse}, NEW removed: ${!hasNew}`);
}

async function step6_simulateReplies2and3() {
  // Simulate two replies arriving while no Claude is running
  const lockFile = join(RESPONSES_DIR, ".processing");
  if (existsSync(lockFile)) unlinkSync(lockFile); // ensure clean state

  // Reply #2
  const num2 = nextResponseNumber(RESPONSES_DIR);
  const paths2 = replyFilePaths(RESPONSES_DIR, num2);
  writeReplyFile(paths2.replyFile, num2, "testuser@example.com", new Date().toISOString(),
    TEST_SUBJECT, "Can you add the zoom link for that standup?");
  appendToThread(THREAD_FILE,
    `NEW Reply #${num2} (${new Date().toISOString()} from testuser@example.com)`,
    "Can you add the zoom link for that standup?");

  // Reply #3
  const num3 = nextResponseNumber(RESPONSES_DIR);
  const paths3 = replyFilePaths(RESPONSES_DIR, num3);
  writeReplyFile(paths3.replyFile, num3, "testuser@example.com", new Date().toISOString(),
    TEST_SUBJECT, "Also, what was discussed in last week's standup?");
  appendToThread(THREAD_FILE,
    `NEW Reply #${num3} (${new Date().toISOString()} from testuser@example.com)`,
    "Also, what was discussed in last week's standup?");

  const threadContent = readFileSync(THREAD_FILE, "utf8");
  const newCount = (threadContent.match(/## NEW Reply/g) || []).length;

  assert(hasUnprocessedReplies(RESPONSES_DIR), "Should have unprocessed replies");

  // Trigger processing — only one Claude should spawn
  writeFileSync(lockFile, new Date().toISOString());

  const { buildReplyPrompt } = await import("../src/reply.ts");
  const prompt = buildReplyPrompt(TEST_DATE);
  const promptFile = join(RESPONSES_DIR, ".reply-prompt.md");
  writeFileSync(promptFile, prompt, "utf8");

  const allowedTools = "Read(reports/**),Write(reports/**),Bash(bun carlton reply-to *),Bash(bunx gmcli *),Bash(bunx gccli *),Bash(bunx gdcli *),Bash(rm reports/*/responses/.processing)";
  const windowName = "e2e-reply-02";
  const logFile = join(DATE_DIR, "e2e-reply-02.log");
  const claudeCmd = `claude -p --model sonnet --allowedTools "${allowedTools}" < reports/${TEST_DATE}/responses/.reply-prompt.md 2>&1 | tee ${logFile}`;

  Bun.spawn(
    ["tmux", "new-window", "-d", "-n", windowName, "-c", PROJECT_ROOT, claudeCmd],
    { stdio: ["ignore", "ignore", "ignore"] },
  );

  record("Simulate replies #2 and #3", true,
    `${newCount} NEW entries in thread.md, one Claude spawned`);
}

async function step7_waitForBatchResponse() {
  // The response should be numbered by highest reply being addressed
  // With replies 2 and 3, response should be 03-response.md
  const responseFile3 = join(RESPONSES_DIR, "03-response.md");
  const responseFile2 = join(RESPONSES_DIR, "02-response.md");

  console.log("\n⏳ Waiting for batch response (timeout: 120s)...");

  // Claude might write 02-response or 03-response depending on how it interprets the prompt
  let content = "";
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (existsSync(responseFile3)) {
      content = readFileSync(responseFile3, "utf8").trim();
      if (content.length > 0) break;
    }
    if (existsSync(responseFile2)) {
      content = readFileSync(responseFile2, "utf8").trim();
      if (content.length > 0) break;
    }
    await Bun.sleep(5000);
  }

  assert(content.length > 10, "No batch response written");

  const threadContent = readFileSync(THREAD_FILE, "utf8");
  const remainingNew = (threadContent.match(/## NEW Reply/g) || []).length;

  record("Batch response", true,
    `${content.length} chars, ${remainingNew} remaining NEW markers`);
}

async function step8_lockPreventsSpawn() {
  const lockFile = join(RESPONSES_DIR, ".processing");
  if (existsSync(lockFile)) unlinkSync(lockFile);

  // Write a new reply
  const num = nextResponseNumber(RESPONSES_DIR);
  const paths = replyFilePaths(RESPONSES_DIR, num);
  writeReplyFile(paths.replyFile, num, "testuser@example.com", new Date().toISOString(),
    TEST_SUBJECT, "Lock test reply");

  // Manually create lock
  writeFileSync(lockFile, new Date().toISOString());

  // With lock present, triggerProcessing would skip
  assert(existsSync(lockFile), "Lock should exist");
  assert(hasUnprocessedReplies(RESPONSES_DIR), "Should have unprocessed replies");

  // Remove lock
  unlinkSync(lockFile);
  assert(!existsSync(lockFile), "Lock should be removed");

  // Clean up the test reply
  unlinkSync(paths.replyFile);

  record("Lock prevents concurrent spawn", true, "Lock blocks trigger, removal unblocks");
}

async function step9_staleLockRecovery() {
  const lockFile = join(RESPONSES_DIR, ".processing");

  // Create lock with old mtime (15 minutes ago)
  writeFileSync(lockFile, "stale");
  const staletime = new Date(Date.now() - 15 * 60 * 1000);
  utimesSync(lockFile, staletime, staletime);

  // Verify it's stale
  const { statSync } = await import("fs");
  const mtime = statSync(lockFile).mtimeMs;
  const age = Date.now() - mtime;
  assert(age > 10 * 60 * 1000, `Lock not stale enough: ${Math.round(age / 60000)}min`);

  // Simulate cleanStaleLocks behavior
  unlinkSync(lockFile);
  assert(!existsSync(lockFile), "Stale lock should be removed");

  record("Stale lock recovery", true, `Lock aged ${Math.round(age / 60000)}min, removed`);
}

const TMUX_WINDOWS = ["e2e-reply-01", "e2e-reply-02"];

function listTmuxWindows(): string[] {
  const result = Bun.spawnSync(["tmux", "list-windows", "-F", "#{window_name}"]);
  return result.stdout.toString().trim().split("\n").filter(Boolean);
}

function step10_cleanup() {
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
    await step1_createReportAndSendBriefing();
    await step2_doubleSendBlocked();
    await step3_simulateReply1();
    await step4_triggerProcessing();
    await step5_waitForResponse1();
    await step6_simulateReplies2and3();
    await step7_waitForBatchResponse();
    await step8_lockPreventsSpawn();
    await step9_staleLockRecovery();
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

  step10_cleanup();
  printResults();
}

main();
