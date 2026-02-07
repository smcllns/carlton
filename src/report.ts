/**
 * Generates meeting prep report files.
 */

import * as fs from "fs";
import * as path from "path";
import { getReportsDir, getMemoryFile } from "./config.ts";
import type { CalendarEvent } from "./calendar.ts";

/** Create the report directory for a date and return empty .md files for each event */
export function createReportFiles(
  date: string,
  events: CalendarEvent[]
): string[] {
  const dateDir = path.join(getReportsDir(), date);
  fs.mkdirSync(dateDir, { recursive: true });

  const paths: string[] = [];

  for (const event of events) {
    const filename = eventToFilename(event);
    const filepath = path.join(dateDir, filename);
    paths.push(filepath);
  }

  return paths;
}

/** Write a report file for an event */
export function writeReport(filepath: string, content: string): void {
  fs.writeFileSync(filepath, content, "utf8");
}

/** Format an event into a basic report */
export function formatBasicReport(event: CalendarEvent): string {
  const lines: string[] = [];

  lines.push(`# ${event.summary}`);
  lines.push("");
  lines.push(`**Time:** ${formatTime(event.start)} - ${formatTime(event.end)}`);

  if (event.location) {
    lines.push(`**Location:** ${event.location}`);
  }

  if (event.htmlLink) {
    lines.push(`**Calendar link:** ${event.htmlLink}`);
  }

  lines.push("");

  if (event.attendees.length > 0) {
    lines.push("## Attendees");
    lines.push("");
    for (const attendee of event.attendees) {
      lines.push(`- ${attendee}`);
    }
    lines.push("");
  }

  if (event.description) {
    lines.push("## Description");
    lines.push("");
    lines.push(event.description);
    lines.push("");
  }

  return lines.join("\n");
}

/** Append a note to memory.txt */
export function appendToMemory(note: string): void {
  const memFile = getMemoryFile();
  const existing = fs.existsSync(memFile)
    ? fs.readFileSync(memFile, "utf8")
    : "";
  const timestamp = new Date().toISOString().split("T")[0];
  const entry = `\n---\n[${timestamp}] ${note}\n`;
  fs.writeFileSync(memFile, existing + entry, "utf8");
}

function eventToFilename(event: CalendarEvent): string {
  // Extract HH-MM from start time
  const timeMatch = event.start.match(/T(\d{2}):(\d{2})/);
  const hh = timeMatch ? timeMatch[1] : "00";
  const mm = timeMatch ? timeMatch[2] : "00";

  // Sanitize title for filename
  const title = event.summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  return `${hh}-${mm}-${title}.md`;
}

function formatTime(iso: string): string {
  if (!iso.includes("T")) return iso; // all-day event
  const date = new Date(iso);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
