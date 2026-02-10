#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
COMPARE_DIR="/tmp/carlton-compare"

# Default to tomorrow
if [[ $# -ge 1 ]]; then
  DATE="$1"
else
  DATE=$(date -v+1d +%Y-%m-%d 2>/dev/null || date -d "+1 day" +%Y-%m-%d)
fi

echo "=== Carlton Comparison: $DATE ==="
echo ""

# --- Step 1: Run TS app ---
echo "--- Running TS app (bun src/index.ts send $DATE --test) ---"
mkdir -p "$COMPARE_DIR/main"

bun "$PROJECT_ROOT/src/index.ts" send "$DATE" --test 2>"$COMPARE_DIR/main-stderr.log" || true

TS_BRIEFING="$PROJECT_ROOT/reports/$DATE/briefing.md"
if [[ -f "$TS_BRIEFING" ]]; then
  cp "$TS_BRIEFING" "$COMPARE_DIR/main/briefing.md"
  echo "TS briefing saved to $COMPARE_DIR/main/briefing.md"
else
  echo "ERROR: TS app did not produce $TS_BRIEFING"
  exit 1
fi

echo ""

# --- Step 2: Skill version (manual) ---
mkdir -p "$COMPARE_DIR/skill"
echo "--- Skill version ---"
echo "Run the skill version manually in Claude Code:"
echo ""
echo "  /carlton send $DATE --test"
echo ""
echo "Then copy the briefing:"
echo ""
echo "  cp reports/$DATE/briefing.md $COMPARE_DIR/skill/briefing.md"
echo ""

if [[ ! -f "$COMPARE_DIR/skill/briefing.md" ]]; then
  echo "Waiting for skill briefing at $COMPARE_DIR/skill/briefing.md ..."
  echo "(Run the commands above, then re-run this script to see the diff)"
  exit 0
fi

# --- Step 3: Diff ---
echo "--- Comparison ---"
echo ""

MAIN_LINES=$(wc -l < "$COMPARE_DIR/main/briefing.md" | tr -d ' ')
SKILL_LINES=$(wc -l < "$COMPARE_DIR/skill/briefing.md" | tr -d ' ')

MAIN_EVENTS=$(grep -c '^## ' "$COMPARE_DIR/main/briefing.md" || echo "0")
SKILL_EVENTS=$(grep -c '^## ' "$COMPARE_DIR/skill/briefing.md" || echo "0")

echo "TS app:  $MAIN_LINES lines, $MAIN_EVENTS events"
echo "Skill:   $SKILL_LINES lines, $SKILL_EVENTS events"
echo ""

echo "--- Diff (TS app vs Skill) ---"
diff --unified=0 "$COMPARE_DIR/main/briefing.md" "$COMPARE_DIR/skill/briefing.md" || true
