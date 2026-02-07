/**
 * Fetches events from all configured calendar accounts for a given date.
 */

import { getCalendar } from "./google.ts";
import { loadConfig } from "./config.ts";

export interface CalendarEvent {
  id: string;
  calendarId: string;
  accountEmail: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  attendees: string[];
  htmlLink?: string;
}

/** Get all events for a specific date across all configured accounts */
export async function getEventsForDate(date: string): Promise<CalendarEvent[]> {
  const cal = getCalendar();
  const accounts = cal.listAccounts();

  if (accounts.length === 0) {
    throw new Error(
      "No calendar accounts configured. Run: gccli accounts add <email>"
    );
  }

  const dayStart = `${date}T00:00:00Z`;
  const dayEnd = `${date}T23:59:59Z`;

  const allEvents: CalendarEvent[] = [];

  for (const account of accounts) {
    const email = account.email;
    try {
      // List all calendars for this account
      const calendars = await cal.listCalendars(email);

      for (const calendar of calendars) {
        const calId = calendar.id;
        if (!calId) continue;

        try {
          const result = await cal.listEvents(email, calId, {
            timeMin: dayStart,
            timeMax: dayEnd,
            maxResults: 100,
          });

          for (const event of result.events) {
            const startTime = event.start?.dateTime || event.start?.date || "";
            const endTime = event.end?.dateTime || event.end?.date || "";

            allEvents.push({
              id: event.id || "",
              calendarId: calId,
              accountEmail: email,
              summary: event.summary || "(no title)",
              start: startTime,
              end: endTime,
              location: event.location || undefined,
              description: event.description || undefined,
              attendees: (event.attendees || []).map(
                (a: any) => a.email || ""
              ),
              htmlLink: event.htmlLink || undefined,
            });
          }
        } catch (err: any) {
          // Skip calendars we can't read (e.g., holidays with no event access)
          console.error(
            `  Skipping calendar ${calendar.summary || calId}: ${err.message}`
          );
        }
      }
    } catch (err: any) {
      console.error(`  Error reading account ${email}: ${err.message}`);
    }
  }

  return dedupeEvents(allEvents);
}

/** Deduplicate events that appear in multiple calendars */
function dedupeEvents(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Map<string, CalendarEvent>();

  for (const event of events) {
    // Key on start time + summary to catch cross-calendar dupes
    const key = `${event.start}|${event.summary}`;
    if (!seen.has(key)) {
      seen.set(key, event);
    }
  }

  // Sort by start time
  return Array.from(seen.values()).sort((a, b) =>
    a.start.localeCompare(b.start)
  );
}
