/**
 * Report formatting helpers.
 */

import type { CalendarEvent } from "./calendar.ts";

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

function formatTime(iso: string): string {
  if (!iso.includes("T")) return iso; // all-day event
  const date = new Date(iso);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
