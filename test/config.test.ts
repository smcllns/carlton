import { describe, expect, test } from "bun:test";
import { getReportsDir, getMemoryFile } from "../src/config.ts";

describe("config", () => {
  test("getReportsDir returns a path ending in reports", () => {
    const dir = getReportsDir();
    expect(dir).toContain("reports");
  });

  test("getMemoryFile returns memory.txt path", () => {
    const file = getMemoryFile();
    expect(file).toContain("memory.txt");
  });
});
