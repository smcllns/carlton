import { describe, expect, test } from "bun:test";
import { getReportsDir } from "../src/config.ts";

describe("config", () => {
  test("getReportsDir returns a path ending in reports", () => {
    const dir = getReportsDir();
    expect(dir).toContain("reports");
  });
});
