#!/bin/sh
# Swap the every-few-minutes LaunchAgents for the single scheduler (com.mfm.video-scripter-scheduler).
#   scripts/install-scheduler.sh          # show what would change
#   scripts/install-scheduler.sh --apply  # do it (asks nothing; run only with Brandon's go-ahead)
#   scripts/install-scheduler.sh --rollback
# Retired plists are moved to ~/Library/LaunchAgents/video-scripter-retired-<date>/, never deleted.
set -eu
cd "$(dirname "$0")/.."
LA="$HOME/Library/LaunchAgents"
UID_=$(id -u)
STAMP=$(date +%Y%m%d-%H%M)
MODE=${1:-}
RETIRED=$(ls launchd/retired/*.plist | xargs -n1 basename)
ACTIVE=$(ls launchd/*.plist | xargs -n1 basename)
say() { echo "$@"; }
run() { if [ "$MODE" = "--apply" ] || [ "$MODE" = "--rollback" ]; then "$@"; else echo "would: $*"; fi; }

if [ "$MODE" = "--rollback" ]; then
  run launchctl bootout "gui/$UID_/com.mfm.video-scripter-scheduler" || true
  BACKUP=$(ls -d "$LA"/video-scripter-retired-* | tail -1)
  for f in $RETIRED; do
    run mv "$BACKUP/$f" "$LA/$f"
    run launchctl bootstrap "gui/$UID_" "$LA/$f"
  done
  exit 0
fi

BACKUP="$LA/video-scripter-retired-$STAMP"
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
  run launchctl bootstrap "gui/$UID_" "$LA/$f"
done
