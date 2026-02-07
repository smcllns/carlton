#!/bin/bash
# Stop hook: reminds the agent to log learnings to memory.txt before finishing.

cat <<'PROMPT'
⚠️ Before you finish, update reports/memory.txt.

Append entries for anything a fresh agent would benefit from knowing:

1. **User preferences** — How does the user want their meeting prep? Format, tone, what to emphasize, what to skip. Any feedback they gave on reports.
2. **Process improvements** — What went wrong, what workaround worked, what to do differently next time.
3. **Technical gotchas** — API quirks, auth issues, data format surprises, library behavior.

Format each entry as:
  [YYYY-MM-DD] category: one-line learning

Example:
  [2026-02-07] preference: User wants attendee names, not email addresses, in report headers.
  [2026-02-07] gotcha: gccli requires Z suffix on datetime strings or returns Bad Request.
  [2026-02-07] process: Subscription calendars (birthdays, holidays) throw Bad Request on listEvents — skip silently.

Skip this if you made no meaningful discoveries this session.
PROMPT
