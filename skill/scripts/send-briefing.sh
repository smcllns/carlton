#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
REPORTS_DIR="$PROJECT_ROOT/reports"

# Load .env from project root
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

FROM="${CARLTON_FROM_EMAIL:-Carlton <onboarding@resend.dev>}"

usage() {
  echo "Usage:"
  echo "  send-briefing.sh send <to> <subject> <date> <briefing-file>"
  echo "  send-briefing.sh check <date>"
  echo "  send-briefing.sh reset <date>"
  exit 1
}

cmd_check() {
  local date="$1"
  local marker="$REPORTS_DIR/$date/.briefing-sent"
  if [[ -f "$marker" ]]; then
    echo "Briefing for $date already sent."
    exit 0
  else
    exit 1
  fi
}

cmd_reset() {
  local date="$1"
  local date_dir="$REPORTS_DIR/$date"
  if [[ -d "$date_dir" ]]; then
    rm -rf "$date_dir"
    echo "Cleared reports/$date/"
  else
    echo "Nothing to clear for $date"
  fi
}

cmd_send() {
  local to="$1"
  local subject="$2"
  local date="$3"
  local briefing_file="$4"

  if [[ ! -f "$briefing_file" ]]; then
    echo "Error: Briefing file not found: $briefing_file" >&2
    exit 1
  fi

  if [[ -z "${RESEND_API_KEY:-}" ]]; then
    echo "Error: RESEND_API_KEY not set. Add it to .env" >&2
    exit 1
  fi

  # Convert markdown to HTML
  local html
  html=$(bun -e "
    import { marked } from 'marked';
    import { readFileSync } from 'fs';
    process.stdout.write(await marked(readFileSync(process.argv[1], 'utf8')));
  " "$briefing_file")

  # Send via Resend API
  local message_id="<carlton-${date}@carlton.local>"
  local payload
  payload=$(jq -n \
    --arg from "$FROM" \
    --arg to "$to" \
    --arg subject "$subject" \
    --arg html "$html" \
    --arg message_id "$message_id" \
    '{
      from: $from,
      to: [$to],
      subject: $subject,
      html: $html,
      headers: {"Message-ID": $message_id}
    }')

  local response
  response=$(curl -s -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer ${RESEND_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$payload")

  local resend_id
  resend_id=$(echo "$response" | jq -r '.id // empty')

  if [[ -z "$resend_id" ]]; then
    echo "Error: Failed to send email" >&2
    echo "$response" >&2
    exit 1
  fi

  # Write sent marker
  local marker_dir
  marker_dir="$(dirname "$briefing_file")"
  echo "{\"resendId\":\"${resend_id}\",\"messageId\":\"${message_id}\"}" > "${marker_dir}/.briefing-sent"

  echo "Sent to ${to} (Message-ID: ${message_id})"
}

# --- Main ---

[[ $# -lt 1 ]] && usage

case "$1" in
  send)
    [[ $# -lt 5 ]] && usage
    cmd_send "$2" "$3" "$4" "$5"
    ;;
  check)
    [[ $# -lt 2 ]] && usage
    cmd_check "$2"
    ;;
  reset)
    [[ $# -lt 2 ]] && usage
    cmd_reset "$2"
    ;;
  *)
    usage
    ;;
esac
