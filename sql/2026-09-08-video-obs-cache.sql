-- video_obs_cache: the merged observation record, one narrow row per video.
--
-- Replaces the three-table union (view_snapshots + view_samples + rss_samples) that the scorer
-- ran for every prior of every scored video, every hour: 118M shared blocks read from disk in
-- four days. See lib/scoring/obs-cache.ts for why this lives in Postgres and not on R2.
--
-- Safe to run at any time: it creates an empty table, and lib/scoring/prior-load.ts treats an
-- empty or missing table as a cache miss and falls back to the union unchanged.
create table if not exists video_obs_cache (
  video_id   text primary key,
  built_at   timestamptz not null default now(),
  n          int not null,
  obs        bytea not null
);

-- `obs` is already gzipped by the writer, so TOAST must not spend CPU trying again.
alter table video_obs_cache alter column obs set storage external;

comment on table video_obs_cache is
  'Merged observation record per video (lib/scoring/observations.ts observationRecords), gzipped '
  'JSON. Written by scripts/rebuild-series.ts off the series_dirty queue and by '
  'scripts/backfill-obs-cache.ts. A row is only trusted while the video is NOT in series_dirty.';
