#!/usr/bin/env bash
# test/e2e/run-e2e-test.sh
#
# End-to-end installation test for the Calendar Year View Thunderbird add-on.
#
# What this test does:
#   1. Locates Thunderbird 153 on the host (snap or system install)
#   2. Prepares a fresh copy of the test profile with the extension proxy
#      pointing to this repository and the ICS calendar URIs patched to
#      the actual local paths
#   3. Starts Thunderbird in a headless virtual display (Xvfb)
#   4. Waits for the Year View space to open and calendars to fully load
#   5. Takes a screenshot showing the Year View calendar page
#   6. Checks the Thunderbird log for errors and warnings that are
#      attributable to the add-on installation
#   7. Verifies the add-on entry appears in the extensions database
#   8. Verifies calendars and events were loaded (calendar names + event counts)
#   9. Reports PASS or FAIL and writes artifacts to test-results/
#
# Usage (from the repository root):
#   ./test/e2e/run-e2e-test.sh
#
# Requirements on the host:
#   - Thunderbird 153.x  (snap: sudo snap install thunderbird)
#   - Xvfb               (apt: sudo apt install xvfb)
#   - scrot              (apt: sudo apt install scrot)
#   - xdotool            (apt: sudo apt install xdotool)
#
# Output:
#   test-results/addon-installed.png   screenshot of the Thunderbird window
#   test-results/thunderbird.log       full Thunderbird stderr log
#   test-results/result.txt            PASS or FAIL

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESULTS_DIR="$REPO_ROOT/test-results"
PROFILE_TEMPLATE="$REPO_ROOT/test/.thunderbird-profile"
PROFILE_TMP=""
TB_BINARY=""
TB_VERSION=""
DISPLAY_NUM=99
XVFB_PID=""
TB_PID=""
EXIT_CODE=0

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
cleanup() {
    local exit_status=$?
    if [ -n "$TB_PID" ] && kill -0 "$TB_PID" 2>/dev/null; then
        kill "$TB_PID" 2>/dev/null || true
        wait "$TB_PID" 2>/dev/null || true
    fi
    if [ -n "$XVFB_PID" ] && kill -0 "$XVFB_PID" 2>/dev/null; then
        kill "$XVFB_PID" 2>/dev/null || true
        wait "$XVFB_PID" 2>/dev/null || true
    fi
    if [ -n "$PROFILE_TMP" ] && [ -d "$PROFILE_TMP" ]; then
        rm -rf "$PROFILE_TMP"
    fi
    exit $exit_status
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "  $*"; }
pass() { echo "  [PASS] $*"; }
fail() { echo "  [FAIL] $*" >&2; EXIT_CODE=1; }

check_prereq() {
    if ! command -v "$1" &>/dev/null; then
        echo "ERROR: '$1' not found. Install it with: $2" >&2
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Step 0: Pre-flight checks
# ---------------------------------------------------------------------------
echo ""
echo "=== Pre-flight checks ==="

check_prereq Xvfb     "sudo apt install xvfb"
check_prereq scrot    "sudo apt install scrot"
check_prereq xdotool  "sudo apt install xdotool"

# Find Thunderbird 153 binary
TB_CANDIDATES=(
    "/snap/thunderbird/current/usr/lib/thunderbird/thunderbird"
    "$(command -v thunderbird 2>/dev/null || true)"
)
for candidate in "${TB_CANDIDATES[@]}"; do
    if [ -x "$candidate" ]; then
        # Verify it actually runs and reports a version
        TB_FOUND_VERSION=$("$candidate" --version 2>/dev/null | grep -oP '\d+\.\d+' | head -1 || true)
        if [ -n "$TB_FOUND_VERSION" ]; then
            TB_BINARY="$candidate"
            TB_VERSION="$TB_FOUND_VERSION"
            break
        fi
    fi
done

if [ -z "$TB_BINARY" ]; then
    echo "ERROR: Thunderbird not found." >&2
    echo "       Install via snap:  sudo snap install thunderbird" >&2
    exit 1
fi

log "Thunderbird $TB_VERSION at $TB_BINARY"

if [[ "$TB_VERSION" != "153"* ]]; then
    echo "WARNING: Expected Thunderbird 153.x but found $TB_VERSION — test continues."
fi

# ---------------------------------------------------------------------------
# Step 1: Set up test profile
# ---------------------------------------------------------------------------
echo ""
echo "=== Setting up test profile ==="

PROFILE_TMP="$(mktemp -d -t tb-e2e-XXXX)"
cp -r "$PROFILE_TEMPLATE/." "$PROFILE_TMP/"

# user.js is the correct file for persistent preferences; prefs.js is
# managed by Thunderbird itself.  If only prefs.js exists, promote it.
if [ ! -f "$PROFILE_TMP/user.js" ] && [ -f "$PROFILE_TMP/prefs.js" ]; then
    cp "$PROFILE_TMP/prefs.js" "$PROFILE_TMP/user.js"
fi

# Build the package layout first because manifest resource URLs are relative
# to the XPI root, not to the source host directory.
just -f "$REPO_ROOT/justfile" build-xpi >/dev/null
echo "$REPO_ROOT/dist/package" > \
    "$PROFILE_TMP/extensions/GlamorousPotato.calendar-annual-view@addons.thunderbird.net"
log "Extension proxy → $REPO_ROOT"

# Patch the ICS calendar URIs in user.js to use the actual repo paths
# (the template uses /workspace which is only correct inside Docker)
sed -i "s|file:///workspace/assets/feiertage_nrw.ics|file://${REPO_ROOT}/assets/feiertage_nrw.ics|g" \
    "$PROFILE_TMP/user.js"
sed -i "s|file:///workspace/assets/ferien_nrw.ics|file://${REPO_ROOT}/assets/ferien_nrw.ics|g" \
    "$PROFILE_TMP/user.js"
log "ICS URIs patched to $REPO_ROOT"

# ---------------------------------------------------------------------------
# Step 2: Start virtual display
# ---------------------------------------------------------------------------
echo ""
echo "=== Starting virtual display :$DISPLAY_NUM ==="

# Kill any leftover Xvfb on this display
pkill -f "Xvfb :${DISPLAY_NUM}" 2>/dev/null || true
sleep 0.5

Xvfb ":${DISPLAY_NUM}" -screen 0 1280x800x24 2>/dev/null &
XVFB_PID=$!
export DISPLAY=":${DISPLAY_NUM}"
sleep 1

log "Xvfb PID $XVFB_PID on DISPLAY $DISPLAY"

# ---------------------------------------------------------------------------
# Step 3: Start Thunderbird
# ---------------------------------------------------------------------------
echo ""
echo "=== Starting Thunderbird $TB_VERSION ==="

mkdir -p "$RESULTS_DIR"
TB_LOG="$RESULTS_DIR/thunderbird.log"

"$TB_BINARY" -profile "$PROFILE_TMP" --no-remote > "$TB_LOG" 2>&1 &
TB_PID=$!
log "Thunderbird PID $TB_PID"

# ---------------------------------------------------------------------------
# Step 4: Wait for Thunderbird window
# ---------------------------------------------------------------------------
echo ""
echo "=== Waiting for Thunderbird window (up to 60s) ==="

WINDOW_FOUND=false
for i in $(seq 1 60); do
    if ! kill -0 "$TB_PID" 2>/dev/null; then
        fail "Thunderbird process exited unexpectedly after ${i}s"
        echo "Last 20 lines of log:" >&2
        tail -20 "$TB_LOG" >&2
        exit 1
    fi
    if xdotool search --class "Thunderbird" &>/dev/null; then
        log "Window detected after ${i}s"
        WINDOW_FOUND=true
        break
    fi
    sleep 1
done

if ! $WINDOW_FOUND; then
    fail "Thunderbird window did not appear within 60s"
    tail -20 "$TB_LOG" >&2
    exit 1
fi

# Give the add-on time to open the Year View space, load calendars, and
# render the full calendar grid.  The background.js onStartup listener fires
# immediately after the window appears, but calendar fetching over local ICS
# files still takes a few seconds on a loaded runner.
log "Waiting 25s for Year View to load and calendar events to render..."
sleep 25

# ---------------------------------------------------------------------------
# Step 5: Take screenshot
# ---------------------------------------------------------------------------
echo ""
echo "=== Taking screenshot ==="

SCREENSHOT="$RESULTS_DIR/addon-installed.png"
scrot "$SCREENSHOT"

# Verify the screenshot has actual content (not a blank black frame).
# We use file size as a reliable proxy: a 1280x800 PNG of a rendered window
# will compress to at least 20 KB; a uniform black frame compresses to under 5 KB.
SCREENSHOT_BYTES=$(stat -c%s "$SCREENSHOT" 2>/dev/null || echo "0")
if [ "${SCREENSHOT_BYTES:-0}" -gt 20000 ]; then
    pass "Screenshot has content (${SCREENSHOT_BYTES} bytes)"
else
    fail "Screenshot appears blank (${SCREENSHOT_BYTES} bytes) — Thunderbird may not have rendered"
fi
log "Saved to test-results/addon-installed.png"

# ---------------------------------------------------------------------------
# Step 6: Shut down Thunderbird cleanly and collect the full log
# ---------------------------------------------------------------------------
echo ""
echo "=== Shutting down Thunderbird ==="

kill "$TB_PID" 2>/dev/null || true
# Give Thunderbird up to 10s to shut down cleanly (it writes profile data)
for i in $(seq 1 10); do
    if ! kill -0 "$TB_PID" 2>/dev/null; then
        break
    fi
    sleep 1
done
kill -9 "$TB_PID" 2>/dev/null || true
wait "$TB_PID" 2>/dev/null || true
TB_PID=""

log "Log: $(wc -l < "$TB_LOG") lines written to test-results/thunderbird.log"

# ---------------------------------------------------------------------------
# Step 7: Check log for add-on errors and warnings
# ---------------------------------------------------------------------------
echo ""
echo "=== Checking log for add-on errors ==="

EXT_ID="GlamorousPotato.calendar-annual-view@addons.thunderbird.net"
EXT_PATTERNS="GlamorousPotato|calendar-annual-view|annual_view|annual.view|CalendarAnnualView"

# Lines that mention our extension AND contain error/warning severity
ADDON_ERRORS=$(grep -iE "(error|exception|warning)" "$TB_LOG" \
    | grep -iE "($EXT_PATTERNS)" \
    | grep -viE "(deprecat|non-fatal|source map|xkbcomp|keysym)" \
    || true)

if [ -n "$ADDON_ERRORS" ]; then
    fail "Add-on related errors/warnings found in log:"
    echo "$ADDON_ERRORS" | while IFS= read -r line; do
        echo "    $line"
    done
else
    pass "No add-on related errors or warnings in log"
fi

# Any WebExtension install-phase failures regardless of our extension
WE_INSTALL_ERRORS=$(grep -iE \
    "(webext.*install.*fail|fail.*install.*webext|extension.*load.*error|error.*load.*extension)" \
    "$TB_LOG" || true)

if [ -n "$WE_INSTALL_ERRORS" ]; then
    fail "WebExtension installation errors found:"
    echo "$WE_INSTALL_ERRORS" | while IFS= read -r line; do
        echo "    $line"
    done
else
    pass "No WebExtension installation errors in log"
fi

# ---------------------------------------------------------------------------
# Step 8: Verify add-on entry in the extensions database
# ---------------------------------------------------------------------------
echo ""
echo "=== Verifying add-on in extensions database ==="

EXT_DB="$PROFILE_TMP/extensions.json"
if [ -f "$EXT_DB" ]; then
    ADDON_ACTIVE=$(python3 -c "
import json, sys
with open('$EXT_DB') as f:
    data = json.load(f)
addons = data.get('addons', [])
for a in addons:
    if 'annual' in a.get('id','').lower() or 'GlamorousPotato' in a.get('id',''):
        print(f\"{a.get('id','?')} active={a.get('active','?')} version={a.get('version','?')}\")
" 2>/dev/null || true)

    if [ -n "$ADDON_ACTIVE" ]; then
        pass "Add-on found in extensions.json: $ADDON_ACTIVE"
    else
        fail "Add-on not found in extensions.json"
        log "(Thunderbird may not have written the database yet — check log manually)"
    fi
else
    log "extensions.json not found (Thunderbird may not have written it yet)"
fi

# ---------------------------------------------------------------------------
# Step 9: Verify calendar and event loading output in log
# ---------------------------------------------------------------------------
echo ""
echo "=== Verifying calendar and event loading output ==="

CALENDARS_LINE=$(grep -m1 "\[ThunderbirdCalendarProvider\] calendars found:" "$TB_LOG" || true)
if [ -n "$CALENDARS_LINE" ]; then
    pass "Calendars loaded: $CALENDARS_LINE"
else
    fail "No calendar list in log — add-on may not have fetched calendars"
fi

# Print each per-calendar event count line so CI output shows exactly which
# calendars loaded and how many events each produced.
CALENDAR_LINES=$(grep "\[ThunderbirdCalendarProvider\] calendar loaded:" "$TB_LOG" || true)
if [ -n "$CALENDAR_LINES" ]; then
    echo "$CALENDAR_LINES" | while IFS= read -r line; do
        pass "  $line"
    done
else
    fail "No per-calendar event counts in log — calendar event fetch may have failed"
fi

EVENTS_DONE_LINE=$(grep -m1 "\[ThunderbirdCalendarProvider\] done" "$TB_LOG" || true)
if [ -n "$EVENTS_DONE_LINE" ]; then
    pass "Total events logged: $EVENTS_DONE_LINE"
else
    fail "No total event count in log — add-on may not have completed event fetch"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "============================================================"
if [ "$EXIT_CODE" -eq 0 ]; then
    echo "  PASS — Calendar Year View add-on installed on Thunderbird"
    echo "         $TB_VERSION with no errors or warnings."
    echo ""
    echo "  Screenshot : test-results/addon-installed.png"
    echo "  Full log   : test-results/thunderbird.log"
    echo "PASS" > "$RESULTS_DIR/result.txt"
else
    echo "  FAIL — See errors above."
    echo ""
    echo "  Log        : test-results/thunderbird.log"
    echo "FAIL" > "$RESULTS_DIR/result.txt"
fi
echo "============================================================"
echo ""

exit "$EXIT_CODE"
