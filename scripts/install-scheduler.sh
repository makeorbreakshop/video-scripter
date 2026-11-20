#!/bin/sh
# Swap the every-few-minutes LaunchAgents for the single scheduler (com.mfm.video-scripter-scheduler).
#   scripts/install-scheduler.sh          # show what would change
#   scripts/install-scheduler.sh --apply  # do it (asks nothing; run only with Brandon's go-ahead)
#   scripts/install-scheduler.sh --rollback
# Retired plists are moved to ~/Library/LaunchAgents-disabled/<date>-*/, never deleted
# (the 2026-11-20 install: ~/Library/LaunchAgents-disabled/2026-11-20-audit/).
set -eu
cd "$(dirname "$0")/.."
LA="$HOME/Library/LaunchAgents"
DISABLED="$HOME/Library/LaunchAgents-disabled"
UID_=$(id -u)
STAMP=$(date +%Y%m%d-%H%M)
MODE=${1:-}
RETIRED=$(ls launchd/retired/*.plist | xargs -n1 basename)
ACTIVE=$(ls launchd/*.plist | xargs -n1 basename)
say() { echo "$@"; }
run() { if [ "$MODE" = "--apply" ] || [ "$MODE" = "--rollback" ]; then "$@"; else echo "would: $*"; fi; }
# launchctl bootout returns before a KeepAlive job has fully exited, and a bootstrap in that window
# fails with "5: Input/output error" (hit on extension-api, 2026-11-20). Retry for ~20 s.
boot() {
  if [ "$MODE" != "--apply" ] && [ "$MODE" != "--rollback" ]; then echo "would: launchctl bootstrap gui/$UID_ $1"; return 0; fi
  i=0
  until launchctl bootstrap "gui/$UID_" "$1"; do
    i=$((i + 1)); [ $i -ge 10 ] && { echo "bootstrap failed: $1" >&2; return 1; }
    sleep 2
  done
}

if [ "$MODE" = "--rollback" ]; then
  run launchctl bootout "gui/$UID_/com.mfm.video-scripter-scheduler" || true
  BACKUP=$(ls -d "$DISABLED"/*/ | while read d; do [ -f "$d/com.mfm.video-scripter-rss-poll.plist" ] && echo "${d%/}"; done | tail -1)
  for f in $RETIRED; do
    run mv "$BACKUP/$f" "$LA/$f"
    boot "$LA/$f"
  done
  exit 0
fi

BACKUP="$DISABLED/$STAMP-scheduler"
run mkdir -p "$BACKUP"
for f in $RETIRED; do
  label=${f%.plist}
  [ -f "$LA/$f" ] || { say "skip $label (not installed)"; continue; }
  run launchctl bootout "gui/$UID_/$label" || true
  run mv "$LA/$f" "$BACKUP/$f"
done
for f in $ACTIVE; do
  label=${f%.plist}
  if [ -f "$LA/$f" ] && cmp -s "launchd/$f" "$LA/$f"; then continue; fi
  run launchctl bootout "gui/$UID_/$label" 2>/dev/null || true
  run cp "launchd/$f" "$LA/$f"
  boot "$LA/$f"
done
