-- The verify-shorts backfill's target query had no index that could serve it (2026-09-04).
--
-- scripts/verify-shorts.ts asked for
--   where shorts_checked_at is null
--     and ((duration ~ '^PT[0-9HMS]+$' and extract(epoch from duration::interval) <= 180)
--          or is_short = true)
--     and published_at > now() - '<n> months'::interval
-- The OR made videos_shorts_unchecked_idx (2026-09-03) unusable: it only covers
-- `duration ~ '^PT'` rows, and is_short=true rows with a non-PT duration are not in it. The
-- planner fell back to idx_videos_published_desc and re-read 100K-200K heap tuples out of a
-- 1.7 GB table for every run. Two backfill LaunchAgents doing that concurrently pinned the
-- instance in IO wait for 10+ minutes at a time; the hourly scorer started timing out at
-- statement_timeout (57014) and its backlog grew from 1.5K to 7.3K videos overnight.
--
-- Fix: index the predicate itself. Both indexes are partial on `shorts_checked_at is null`, so
-- they shrink to nothing as the backfill completes instead of costing writes forever.
--
-- The duration parse is a plain immutable function rather than a stored `duration_seconds`
-- column on purpose: a column would need a 750K-row UPDATE (heap rewrite + WAL + bloat) on the
-- very instance we are trying to unload, where an index build is a single read pass.
-- Keep it in step with durationSeconds() / classifyItem() in lib/scoring/longform.ts and
-- lib/ingest/classify.ts: <=0 seconds means a placeholder ('P0D', 'PT'), not a clip.

create or replace function iso8601_duration_seconds(dur text) returns integer
  language sql immutable strict parallel safe as $$
  select nullif(greatest(
    coalesce(m[1]::int, 0) * 86400 + coalesce(m[2]::int, 0) * 3600
      + coalesce(m[3]::int, 0) * 60 + coalesce(m[4]::int, 0), 0), 0)
  from regexp_match(dur, '^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$') as m;
$$;

-- Default backfill: unchecked clips (<= SHORT_MAX_SECONDS) plus everything the old CDN
-- detector flagged. Predicate is written exactly as scripts/verify-shorts.ts asks it.
create index concurrently if not exists videos_shorts_backfill_idx
  on videos (published_at desc)
  where shorts_checked_at is null
    and (is_short or iso8601_duration_seconds(duration) <= 180);

-- --only-flagged backfill: the ~68K rows the CDN detector marked is_short (~10% false
-- positives). Narrow enough that the run's target list comes back in milliseconds.
create index concurrently if not exists videos_shorts_flagged_unchecked_idx
  on videos (published_at desc)
  where shorts_checked_at is null and is_short;

-- Superseded by videos_shorts_backfill_idx (which covers the same rows and the is_short arm
-- the old one could not). 3 scans since it was created yesterday.
drop index concurrently if exists videos_shorts_unchecked_idx;
