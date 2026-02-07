import { describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as path from "path";

describe("email.ts isolation", () => {
  const emailSource = fs.readFileSync(
    path.join(import.meta.dir, "email.ts"),
    "utf8"
  );

  test("does not import google.ts", () => {
    expect(emailSource).not.toContain("./google");
  });

  test("does not reference Google service accessors", () => {
    expect(emailSource).not.toContain("getGmail");
    expect(emailSource).not.toContain("getCalendar");
    expect(emailSource).not.toContain("getDrive");
  });

  test("does not import Google service libraries", () => {
    expect(emailSource).not.toContain("@mariozechner/gmcli");
    expect(emailSource).not.toContain("@mariozechner/gccli");
    expect(emailSource).not.toContain("@mariozechner/gdcli");
  });

  test("uses Resend for sending", () => {
    expect(emailSource).toContain("from \"resend\"");
  });
});
