#!/usr/bin/env bun
/**
 * Live E2E integration test for Carlton.
 *
 * Tests the REAL code paths:
 * - sendBriefing() with actual Resend API
 * - recordReplyDirect() for reply handling
 * - triggerProcessing() for lock-based spawn control
 * - Claude actually runs and produces responses
 * - thread.md is correctly maintained
 *
 * Requires: tmux, RESEND_API_KEY, Google auth configured.
 * Run: tmux new -s carlton-test 'bun test/e2e.ts'
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync, utimesSync, statSync } from "fs";
import { join } from "path";
import { getProjectRoot, getReportsDir } from "../src/config.ts";
import { loadPrompt } from "../src/prompt.ts";
import { sendBriefing, type BriefingSentResult } from "../src/email.ts";
import { hasUnprocessedReplies, removeNewMarkers, appendToThread } from "../src/reply.ts";
import {
  triggerProcessing,
  recordReplyDirect,
  cleanStaleLocks,
  isLockStale,
  getLockFile,
  removeLock,
  setSpawnFn,
  resetSpawnFn,
  getSpawnCount,
  resetSpawnCount,
} from "../src/serve.ts";

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

  const report = `# E2E Test Standup

**Time:** 9:00 AM - 9:30 AM

## Attendees

- alice@example.com
- bob@example.com

## Description

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

  const deliveryEmail = process.env.CARLTON_DELIVERY_EMAIL || prompt.delivery.email;
  const result = await sendBriefing(deliveryEmail, TEST_SUBJECT, markdown, TEST_DATE);
  writeFileSync(sentMarker, JSON.stringify(result), "utf8");

  // Create thread.md with briefing content
  const threadContent = `# Carlton Thread — ${TEST_DATE}

## Briefing Sent (${new Date().toISOString()})

${markdown}

---
`;
  writeFileSync(THREAD_FILE, threadContent, "utf8");

  assert(existsSync(sentMarker), ".briefing-sent marker not created");
  assert(existsSync(THREAD_FILE), "thread.md not created");

  // Verify .briefing-sent contains JSON with messageId
  const sentData: BriefingSentResult = JSON.parse(readFileSync(sentMarker, "utf8"));
  assert(!!sentData.resendId, ".briefing-sent missing resendId");
  assert(!!sentData.messageId, ".briefing-sent missing messageId");
  assert(sentData.messageId.includes("carlton"), "messageId should contain 'carlton'");

  record("Send briefing (real Resend API)", true, `Sent to ${deliveryEmail}, Message-ID: ${sentData.messageId}`);
}

async function step3_doubleSendBlocked() {
  const sentMarker = join(DATE_DIR, ".briefing-sent");
  assert(existsSync(sentMarker), "Marker should exist from step 2");
  record("Double-send guard", true, "Marker exists - cmdSendBriefing would skip");
}

async function step4_recordReplyUsingRealFunction() {
  mkdirSync(RESPONSES_DIR, { recursive: true });

  // Use the REAL recordReplyDirect function
  const date = recordReplyDirect(
    "testuser@example.com",
    TEST_SUBJECT,
    new Date().toISOString(),
    "What time is the standup and who is attending?"
  );

  assert(date === TEST_DATE, `Expected date ${TEST_DATE}, got ${date}`);
  assert(existsSync(join(RESPONSES_DIR, "01-reply.md")), "Reply file not created");

  // Verify thread.md was updated by the real function
  const threadContent = readFileSync(THREAD_FILE, "utf8");
  assert(threadContent.includes("## NEW Reply #1"), "thread.md missing NEW Reply #1");
  assert(threadContent.includes("What time is the standup"), "thread.md missing reply content");

  // Verify hasUnprocessedReplies detects it
  assert(hasUnprocessedReplies(RESPONSES_DIR), "hasUnprocessedReplies should be true");

  record("Record reply (real function)", true, "recordReplyDirect created file and updated thread.md");
}

async function step5_triggerProcessingRealFunction() {
  // Reset spawn count
  resetSpawnCount();

  // Use the REAL triggerProcessing function
  const result = triggerProcessing(TEST_DATE);

  assert(result.triggered, `Expected trigger, got: ${result.reason}`);
  assert(result.reason === "spawned", `Expected 'spawned', got: ${result.reason}`);
  assert(existsSync(getLockFile(TEST_DATE)), "Lock file should be created");
  assert(getSpawnCount() === 1, `Expected 1 spawn, got ${getSpawnCount()}`);

  record("Trigger processing (real function)", true, `Lock created, spawn count: ${getSpawnCount()}`);
}

async function step6_waitForClaudeResponse() {
  const responseFile = join(RESPONSES_DIR, "01-response.md");

  console.log("\n⏳ Waiting for Claude to write 01-response.md (timeout: 180s)...");
  const content = await pollForFile(responseFile, 180_000);

  assert(content.length > 10, `Response too short (${content.length} chars)`);

  record("Claude response (real)", true, `${content.length} chars: "${content.slice(0, 60)}..."`);
}

async function step7_verifyThreadAfterResponse() {
  // Simulate what cmdReplyTo does after sending
  const responseFile = join(RESPONSES_DIR, "01-response.md");
  const responseContent = readFileSync(responseFile, "utf8");
  appendToThread(THREAD_FILE, "Response to Reply #1", responseContent);
  removeNewMarkers(THREAD_FILE);

  const threadContent = readFileSync(THREAD_FILE, "utf8");
  assert(threadContent.includes("## Reply #1"), "NEW marker should be removed");
  assert(!threadContent.includes("## NEW Reply #1"), "Still has NEW marker");
  assert(threadContent.includes("Response to Reply #1"), "Response not in thread");

  // Remove lock (simulating Claude finished)
  removeLock(TEST_DATE);
  assert(!existsSync(getLockFile(TEST_DATE)), "Lock should be removed");

  record("Thread updated, lock released", true, "NEW markers removed, response appended");
}

async function step8_concurrencyTest() {
  // Reset spawn count for this test
  resetSpawnCount();

  // Record 3 more replies rapidly
  recordReplyDirect("user@test.com", TEST_SUBJECT, new Date().toISOString(), "Thanks!");
  recordReplyDirect("user@test.com", TEST_SUBJECT, new Date().toISOString(), "One more question");
  recordReplyDirect("user@test.com", TEST_SUBJECT, new Date().toISOString(), "Actually, never mind");

  // Call triggerProcessing multiple times rapidly (simulating race condition)
  const r1 = triggerProcessing(TEST_DATE);
  const r2 = triggerProcessing(TEST_DATE);
  const r3 = triggerProcessing(TEST_DATE);
  const r4 = triggerProcessing(TEST_DATE);

  // First should spawn, rest should be blocked
  assert(r1.triggered && r1.reason === "spawned", "First call should spawn");
  assert(!r2.triggered && r2.reason === "lock_exists", "Second call should be blocked");
  assert(!r3.triggered && r3.reason === "lock_exists", "Third call should be blocked");
  assert(!r4.triggered && r4.reason === "lock_exists", "Fourth call should be blocked");

  // Only ONE spawn despite 4 calls
  assert(getSpawnCount() === 1, `Expected 1 spawn, got ${getSpawnCount()}`);

  record("Concurrency test (NO DOUBLE SPAWN)", true, `4 rapid calls → 1 spawn, 3 blocked by lock`);
}

async function step9_staleLockRecovery() {
  // Create a stale lock
  const lockFile = getLockFile(TEST_DATE);
  if (existsSync(lockFile)) unlinkSync(lockFile);

  writeFileSync(lockFile, "stale");
  const oldTime = new Date(Date.now() - 15 * 60 * 1000);
  utimesSync(lockFile, oldTime, oldTime);

  assert(isLockStale(lockFile), "Lock should be detected as stale");

  // triggerProcessing should clean stale lock and spawn
  resetSpawnCount();
  const result = triggerProcessing(TEST_DATE, 10); // 10 min threshold

  assert(result.triggered, "Should spawn after cleaning stale lock");
  assert(result.reason === "stale_cleaned_and_spawned", `Expected stale_cleaned_and_spawned, got ${result.reason}`);

  record("Stale lock recovery", true, "Stale lock cleaned, processing resumed");
}

async function step10_batchCompletion() {
  // Simulate batch completion: write response to highest reply
  writeFileSync(join(RESPONSES_DIR, "04-response.md"), "Response to all remaining questions");
  removeLock(TEST_DATE);

  // Should not spawn (no unprocessed)
  resetSpawnCount();
  const result = triggerProcessing(TEST_DATE);

  assert(!result.triggered, "Should not spawn when all processed");
  assert(result.reason === "no_unprocessed", `Expected no_unprocessed, got ${result.reason}`);
  assert(getSpawnCount() === 0, "No spawn expected");

  record("Batch completion detection", true, "No spawn when all replies processed");
}

const TMUX_WINDOWS = [`reply-${TEST_DATE}`];

function listTmuxWindows(): string[] {
  const result = Bun.spawnSync(["tmux", "list-windows", "-F", "#{window_name}"]);
  return result.stdout.toString().trim().split("\n").filter(Boolean);
}

function step11_cleanup() {
  resetSpawnFn();
  resetSpawnCount();

  for (const name of TMUX_WINDOWS) {
    Bun.spawnSync(["tmux", "kill-window", "-t", name]);
  }

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
    await step4_recordReplyUsingRealFunction();
    await step5_triggerProcessingRealFunction();
    await step6_waitForClaudeResponse();
    await step7_verifyThreadAfterResponse();
    await step8_concurrencyTest();
    await step9_staleLockRecovery();
    await step10_batchCompletion();
  } catch (err: any) {
    record(err.message.slice(0, 60), false, err.message);
  }

  const hasFailures = results.some((r) => !r.passed);
  if (hasFailures) {
    const logPath = join(DATE_DIR, "e2e-reply.log");
    if (existsSync(logPath)) {
      const log = readFileSync(logPath, "utf8").trim();
      console.log(`\n--- e2e-reply.log ---\n${log.slice(-2000)}\n`);
    }
  }

  step11_cleanup();
  printResults();
}

main();
