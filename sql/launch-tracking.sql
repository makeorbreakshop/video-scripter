-- Launch-window tracking (Sept 2026). Additive, small tables; nothing here touches videos.
-- Applied with: psql "$DATABASE_URL" -f sql/launch-tracking.sql

-- Per-video schedule state. One row per tracked video; replaces stamping last_checked on big tables.
create table if not exists track_schedule (
  video_id        text primary key,
  channel_id      text,
  published_at    timestamptz not null,
  phase           text not null check (phase in ('launch','fixed','catalog')),
  next_check      timestamptz not null,
  launch_until    timestamptz,             -- while now() < launch_until, sample every run
  entered_reason  text,                    -- 'publish' | 'thumbnail_change' | 'title_change' | 'backfill'
  checks          integer not null default 0,
  last_sample_at  timestamptz,
  last_views      integer,
  last_title_check timestamptz,
  last_version_seen integer not null default 0,   -- highest thumbnail_versions.version already reacted to
  updated_at      timestamptz not null default now()
);
create index if not exists idx_track_schedule_due on track_schedule (next_check) ;
create index if not exists idx_track_schedule_phase on track_schedule (phase, next_check);

-- High-resolution samples (15-min in the launch window). Daily truth stays in view_snapshots.
create table if not exists view_samples (
  video_id      text not null,
  sampled_at    timestamptz not null,
  view_count    integer not null,
  like_count    integer,
  comment_count integer,
  primary key (video_id, sampled_at)
);

-- Title history, detected from channel RSS (zero quota).
create table if not exists title_versions (
  video_id   text not null,
  version    integer not null,
  title      text not null,
  first_seen timestamptz not null default now(),
  primary key (video_id, version)
);

-- 2026-09-02: perceptual identity for thumbnail versions (CDN re-encodes flip sha256 without changing the picture)
alter table thumbnail_versions add column if not exists phash text;
create index if not exists idx_thumbver_phash on thumbnail_versions (video_id, phash);
