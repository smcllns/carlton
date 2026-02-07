import { describe, expect, test } from "bun:test";
import { loadConfig, getReportsDir, getMemoryFile } from "./config.ts";

describe("config", () => {
  test("loadConfig returns defaults when no config file exists", () => {
    const config = loadConfig();
    expect(config.accounts).toEqual([]);
  });

  test("getReportsDir returns a path ending in reports", () => {
    const dir = getReportsDir();
    expect(dir).toContain("reports");
  });

  test("getMemoryFile returns memory.txt path", () => {
    const file = getMemoryFile();
    expect(file).toContain("memory.txt");
  });
});
