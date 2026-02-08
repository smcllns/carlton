import { describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as path from "path";

/**
 * Safety tests: verify Carlton source code never calls write/send/delete methods.
 * Carlton is READ-ONLY. These tests catch accidental use of dangerous APIs.
 */

const SRC_DIR = path.join(import.meta.dir, "..", "src");

// Methods that must NEVER appear in Carlton source (excluding test files)
const FORBIDDEN_METHODS = [
  // Gmail write operations
  "sendMessage",
  "sendDraft",
  "createDraft",
  "updateDraft",
  "deleteDraft",
  "modifyLabels",
  // Calendar write operations
  "createEvent",
  "updateEvent",
  "deleteEvent",
  // Drive write operations
  ".upload(",
  ".delete(",
  ".mkdir(",
  ".move(",
  ".rename(",
  ".share(",
  ".unshare(",
];

function getSourceFiles(): string[] {
  return fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(SRC_DIR, f));
}

describe("read-only safety", () => {
  const sourceFiles = getSourceFiles();

  for (const method of FORBIDDEN_METHODS) {
    test(`source code never calls ${method}`, () => {
      for (const file of sourceFiles) {
        const content = fs.readFileSync(file, "utf8");
        const found = content.includes(method);
        if (found) {
          throw new Error(
            `SAFETY VIOLATION: ${path.basename(file)} contains "${method}". Carlton is read-only!`
          );
        }
      }
    });
  }

  test("no source file imports send/write utilities", () => {
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, "utf8");
      expect(content).not.toContain("sendMessage");
      expect(content).not.toContain("createEvent");
    }
  });

  test("email.ts does not import google.ts or Google services", () => {
    const emailFile = path.join(SRC_DIR, "email.ts");
    if (!fs.existsSync(emailFile)) return;
    const content = fs.readFileSync(emailFile, "utf8");
    expect(content).not.toContain("./google");
    expect(content).not.toContain("getGmail");
    expect(content).not.toContain("getCalendar");
    expect(content).not.toContain("getDrive");
    expect(content).not.toContain("@mariozechner/gmcli");
    expect(content).not.toContain("@mariozechner/gccli");
    expect(content).not.toContain("@mariozechner/gdcli");
  });
});
