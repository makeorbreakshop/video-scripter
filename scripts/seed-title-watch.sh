#!/bin/bash
# One-off seed of video_title_watch from videos.title_observed_at (sql/2026-09-04-video-title-watch.sql).
#
# Keyset-paginated on title_observed_at so each batch is a bounded scan of idx_videos_title_observed
# instead of a full-index sort. EXPLAIN'd 2026-09-04: 20,000 rows = 29,166 buffers, 11.3 s on a
# contended instance. 79,323 rows total, so ~4 batches. Idempotent: re-running only refreshes stamps
# via greatest(), never moves one backwards.
set -euo pipefail
cd "$(dirname "$0")/.."
URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)
BATCH=${BATCH:-20000}
PAUSE=${PAUSE:-5}
cursor='-infinity'
total=0
while :; do
  out=$(psql "$URL" -qtAX -v ON_ERROR_STOP=1 \
    -c "set statement_timeout='120s'" \
    -c "with batch as (
          select id, title_observed_at from videos
           where title_observed_at > '${cursor}'::timestamptz
           order by title_observed_at, id limit ${BATCH}
        ), ins as (
          insert into video_title_watch (video_id, title_observed_at)
          select id, title_observed_at from batch
          on conflict (video_id) do update
             set title_observed_at = greatest(video_title_watch.title_observed_at, excluded.title_observed_at)
          returning 1
        )
        select count(*), coalesce(max(title_observed_at)::text, '')
          from batch;")
  n=${out%%|*}; next=${out#*|}
  total=$((total + n))
  echo "$(date -u +%FT%TZ) seeded ${n} (running ${total}), cursor -> ${next:-<end>}"
  [ "$n" -eq 0 ] && break
  [ -z "$next" ] && break
  # A batch that ends mid-timestamp would loop forever on `>`; identical stamps are rare here but
  # the upsert makes a re-read harmless, and the strict `>` guarantees forward progress.
  [ "$next" = "$cursor" ] && { echo "cursor stalled at ${cursor}; stopping"; break; }
  cursor=$next
  sleep "$PAUSE"
done
# Batches keyed on `>` skip rows sharing the boundary timestamp (bulk stamps give thousands of rows
# the identical `now`), so finish with one exact anti-join catch-up. Measured 2026-09-04: 79,324 rows
# total, catch-up alone ran in 17 s once the batches had warmed the pages.
echo "$(date -u +%FT%TZ) catch-up pass"
psql "$URL" -qX -v ON_ERROR_STOP=1 -c "set statement_timeout='300s'" -c "
  insert into video_title_watch (video_id, title_observed_at)
  select v.id, v.title_observed_at from videos v where v.title_observed_at is not null
  on conflict (video_id) do update
     set title_observed_at = greatest(video_title_watch.title_observed_at, excluded.title_observed_at);"
psql "$URL" -qtAX -c "select (select count(*) from video_title_watch) || ' rows in video_title_watch, ' ||
                             (select count(*) from videos where title_observed_at is not null) || ' in the frozen column'"
