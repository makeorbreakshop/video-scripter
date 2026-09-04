-- Move the title-observation stamp off `videos` (P1-8 in docs/runbooks/2026-09-04-supabase-audit.md).
--
-- WHY. `videos` has a 1,819-byte average row, ~794 MB of TOAST and 45 indexes, and only 18.2 % of
-- its updates are HOT. Every `update videos set title_observed_at = ...` therefore rewrites the
-- whole tuple and up to 45 index entries. Measured in a clean 9-minute window on 2026-09-04 that
-- one statement was 181,033 ms = **22 % of all execution on the instance**, 30.2 s mean, 701 MB
-- read; sampled live at 11:27 UTC it was 116 s deep in IO/DataFileRead on a single rss-poll tick.
-- The stamp is a 50-byte fact that changes every five minutes. It does not belong on the widest,
-- most-indexed table in the database.
--
-- WHAT. A narrow side table, one index (its PK), no TOAST, no dependants. A stamp write becomes a
-- ~50-byte upsert against one index instead of a 1.8 KB row rewrite against 45.
--
-- `videos.title_observed_at` is DELIBERATELY LEFT IN PLACE and is no longer written. It is the
-- rollback: revert the code and the column still holds every stamp taken up to this migration.
-- Drop it only after this table has been the sole source for a full evidence window (7 days).
--
-- Idempotent: safe to re-run.

create table if not exists video_title_watch (
  video_id          text primary key,
  title_observed_at timestamptz not null
);

comment on table video_title_watch is
  'When any detector last OBSERVED a video''s title (changed or not). Read by the CHANGE/SYNC rule '
  'in lib/rss/title-change.ts. Split out of videos.title_observed_at on 2026-09-04 because stamping '
  'it on `videos` was 22 % of instance CPU. videos.title_observed_at is frozen, not dropped.';

-- Seed. Run by scripts/seed-title-watch.sh in batches of 20,000 with pauses; this is the
-- statement it issues, keyset-paginated on videos.id so every batch is index-served.
-- Left here for the record and for a manual re-run:
--
--   insert into video_title_watch (video_id, title_observed_at)
--   select id, title_observed_at from videos
--    where title_observed_at is not null and id > $1
--    order by id limit 20000
--   on conflict (video_id) do update
--      set title_observed_at = greatest(video_title_watch.title_observed_at, excluded.title_observed_at);
