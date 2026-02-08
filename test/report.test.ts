import { describe, expect, test } from "bun:test";
import {
  formatBasicReport,
  createReportFiles,
} from "../src/report.ts";
import type { CalendarEvent } from "../src/calendar.ts";
import * as fs from "fs";
import * as path from "path";

const sampleEvent: CalendarEvent = {
  id: "evt1",
  calendarId: "primary",
  accountEmail: "user@gmail.com",
  summary: "Weekly Standup",
  start: "2026-02-10T09:00:00-05:00",
  end: "2026-02-10T09:30:00-05:00",
  location: "Zoom",
  description: "Team sync",
  attendees: ["alice@example.com", "bob@example.com"],
  htmlLink: "https://calendar.google.com/event?id=evt1",
};

describe("formatBasicReport", () => {
  test("includes event title and time on one line", () => {
    const report = formatBasicReport(sampleEvent);
    expect(report).toContain("Weekly Standup");
    expect(report).toContain("🍩");
  });

  test("includes location and attendees on detail line", () => {
    const report = formatBasicReport(sampleEvent);
    expect(report).toContain("Zoom");
    expect(report).toContain("alice@example.com");
    expect(report).toContain("bob@example.com");
  });

  test("includes description", () => {
    const report = formatBasicReport(sampleEvent);
    expect(report).toContain("Team sync");
  });

  test("handles event with no optional fields", () => {
    const minimal: CalendarEvent = {
      id: "evt2",
      calendarId: "primary",
      accountEmail: "user@gmail.com",
      summary: "Quick Chat",
      start: "2026-02-10T14:00:00",
      end: "2026-02-10T14:15:00",
      attendees: [],
    };
    const report = formatBasicReport(minimal);
    expect(report).toContain("Quick Chat");
    const lines = report.split("\n");
    expect(lines.length).toBe(1);
  });

  test("handles all-day event", () => {
    const allDay: CalendarEvent = {
      id: "evt3",
      calendarId: "primary",
      accountEmail: "user@gmail.com",
      summary: "Company Offsite",
      start: "2026-02-10",
      end: "2026-02-11",
      attendees: [],
    };
    const report = formatBasicReport(allDay);
    expect(report).toContain("2026-02-10");
  });
});

describe("createReportFiles", () => {
  test("returns correct file paths", () => {
    const paths = createReportFiles("2026-02-10", [sampleEvent]);
    expect(paths.length).toBe(1);
    expect(paths[0]).toContain("2026-02-10");
    expect(paths[0]).toContain("09-00-weekly-standup.md");
  });

  test("creates date directory", () => {
    createReportFiles("2026-02-10", [sampleEvent]);
    const dir = path.join("reports", "2026-02-10");
    expect(fs.existsSync(dir)).toBe(true);
  });
});
