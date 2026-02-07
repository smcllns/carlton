/**
 * Thin wrappers around gmcli, gccli, gdcli service classes.
 * These tools each store auth in ~/.gmcli/, ~/.gccli/, ~/.gdcli/.
 * Carlton imports them as libraries for structured data access.
 */

import { GmailService } from "@mariozechner/gmcli";
import { CalendarService } from "@mariozechner/gccli";
import { DriveService } from "@mariozechner/gdcli";

// Singleton instances - each reads from its own ~/.{tool}/ config
let gmailService: GmailService | null = null;
let calendarService: CalendarService | null = null;
let driveService: DriveService | null = null;

export function getGmail(): GmailService {
  if (!gmailService) gmailService = new GmailService();
  return gmailService;
}

export function getCalendar(): CalendarService {
  if (!calendarService) calendarService = new CalendarService();
  return calendarService;
}

export function getDrive(): DriveService {
  if (!driveService) driveService = new DriveService();
  return driveService;
}

/** Check which tools have accounts configured */
export function checkAuth(): {
  gmail: string[];
  calendar: string[];
  drive: string[];
} {
  return {
    gmail: getGmail().listAccounts().map((a: any) => a.email),
    calendar: getCalendar().listAccounts().map((a: any) => a.email),
    drive: getDrive().listAccounts().map((a: any) => a.email),
  };
}
