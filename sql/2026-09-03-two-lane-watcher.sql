-- Two-lane watcher (2026-09-03, docs/plans/2026-09-03-two-lane-watcher.md).
-- Free lane: channel RSS poller + faster thumbnail CDN tiers. Additive and idempotent.
-- Applied with: psql "$DATABASE_URL" -f sql/2026-09-03-two-lane-watcher.sql

-- Per-channel RSS poll state. Kept off channel_tracking / discovered_channels on purpose:
-- the poller writes this table every tick and nothing else reads it.
create table if not exists channel_rss_state (
  channel_id        text primary key,
  rss_state         text not null default 'active' check (rss_state in ('active','dormant','woken')),
  rss_etag          text,                  -- YouTube does not send one today; kept for when it does
  rss_body_sha      text,                  -- sha256 of the last body: our stand-in for a 304
  rss_last_polled   timestamptz,
  rss_last_status   integer,
  rss_backoff_until timestamptz,
  rss_interval_sec  integer,               -- doubled on 429/5xx, cleared on success
  last_upload_at    timestamptz,           -- newest published_at we know for the channel
  updated_at        timestamptz not null default now()
);
-- Due-channel selection walks this ordering; nulls first so fresh channels poll immediately.
create index if not exists idx_channel_rss_due on channel_rss_state (rss_last_polled nulls first);

-- Free dense view/like trace straight off the feed. NOT used for scoring; view_samples
-- (Data API) stays the source of truth.
create table if not exists rss_samples (
  video_id text not null,
  at       timestamptz not null,
  views    bigint,
  likes    bigint,
  primary key (video_id, at)
);
create index if not exists idx_rss_samples_at on rss_samples (at desc);

-- Description history. No feed event yet (out of scope in the plan), just the archive.
create table if not exists description_versions (
  video_id    text not null,
  version     integer not null,
  sha256      text not null,
  description text not null,
  first_seen  timestamptz not null default now(),
  primary key (video_id, version)
);

-- CDN ETag for conditional thumbnail fetches (i.ytimg.com does send these).
alter table thumbnail_versions add column if not exists etag text;

-- Subset gate for the staged rollout: WATCH_SUBSET=1 / --subset restricts both the RSS
-- poller and the new thumbnail tiers to these channels.
create table if not exists watch_subset (
  channel_id text primary key,
  reason     text,
  added_at   timestamptz not null default now()
);

-- Stats-lane re-entry on title changes (plan section 5). The schedule already tracks the
-- highest thumbnail version it reacted to; titles get the same marker so a title_versions row
-- written by any path (RSS poller, oEmbed, a backfill) re-opens the change ladder exactly once.
alter table track_schedule add column if not exists last_title_version_seen integer not null default 0;
