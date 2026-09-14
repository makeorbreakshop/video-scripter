#!/bin/sh
# Nightly: archive raw readings to R2, then thin Postgres — ALWAYS BOTH.
#
# This script exists because of the `&&` it replaces.
#
# com.mfm.video-scripter-archive-readings ran `archive-readings && thin-readings`. On
# 2026-09-08 the shrink guard correctly REFUSED to re-archive rss 2026-09-03 (that day had
# already been thinned, so re-writing it would have deleted the difference from R2 as well).
# archive-readings exited 1. The `&&` then skipped thinning — for every one of the sixteen
# perfectly verified days too. That repeated for six nights while rss_samples grew to 9.4 M
# rows older than the dense window, and it is the single largest reason the disk filled.
#
# Thinning is gated on the ledger, not on this script's control flow: scripts/thin-readings.ts
# refuses any day that is not written, read back and matched in R2 (lib/readings/retention.ts
# isThinnable). So running it after a failed archive is safe by construction — a day the archive
# step could not verify is simply not thinnable, and the deletion of the days that ARE verified
# is never held hostage to one bad day.
#
# Both exit codes are reported. The job fails if either step failed, but only AFTER both have run.
set -u

cd "$(dirname "$0")/.." || exit 1

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) archive-then-thin: starting"

npx tsx scripts/archive-readings.ts "$@"
archive_status=$?
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) archive-readings exit=${archive_status}"

# Deliberately unconditional.
npx tsx scripts/thin-readings.ts
thin_status=$?
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) thin-readings exit=${thin_status}"

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) archive-then-thin: archive=${archive_status} thin=${thin_status}"

if [ "${archive_status}" -ne 0 ] || [ "${thin_status}" -ne 0 ]; then
  exit 1
fi
exit 0
