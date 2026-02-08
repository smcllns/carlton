/**
 * Generates meeting prep report files.
 */

import * as fs from "fs";
import * as path from "path";
import { getReportsDir } from "./config.ts";
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

/** Format an event into a basic report (one compact line + optional details) */
export function formatBasicReport(event: CalendarEvent): string {
  const lines: string[] = [];
  const time = `${formatTime(event.start)} – ${formatTime(event.end)}`;
  lines.push(`🍩 *${time}: ${event.summary}*`);

  const details: string[] = [];
  if (event.location) details.push(event.location);
  if (event.attendees.length > 0) details.push(event.attendees.join(", "));
  if (details.length > 0) lines.push(details.join(" · "));

  if (event.description) {
    lines.push(event.description);
  }

  return lines.join("\n");
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
