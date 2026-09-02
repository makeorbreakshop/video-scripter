-- Feed events + public API keys (2026-09-02). Additive; nothing here touches videos.
-- Applied with: psql "$DATABASE_URL" -f sql/feed-events.sql

-- Materialized activity stream. One row per interesting thing that happened to a video.
-- Rebuilt idempotently by scripts/feed-materialize.ts; dedupe_key makes re-runs no-ops.
create table if not exists feed_events (
  id         bigserial primary key,
  type       text not null,
  channel_id text,
  video_id   text,
  at         timestamptz not null,
  payload    jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique
);
create index if not exists idx_feed_events_channel_at on feed_events (channel_id, at desc);
create index if not exists idx_feed_events_at on feed_events (at desc);
-- Keyset pagination for the feed orders on (at desc, id desc); the channel index above
-- covers the per-channel scan, this one the "everything" scan.
create index if not exists idx_feed_events_at_id on feed_events (at desc, id desc);
create index if not exists idx_feed_events_video on feed_events (video_id, type);

-- Incremental materialization watermarks: one row per source table.
-- Incremental materialization watermarks: one row per source table. The cursor is the tuple
-- (last_at, last_id), not just the timestamp: bulk imports stamp thousands of rows with one
-- identical import_date, and a timestamp-only cursor can never step past such a block.
create table if not exists feed_watermarks (
  source  text primary key,
  last_at timestamptz not null,
  last_id text not null default ''
);
alter table feed_watermarks add column if not exists last_id text not null default '';

-- Public API v1 bearer keys. Only the sha256 hash is stored; the plaintext is shown once.
create table if not exists api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  key_hash     text not null unique,
  prefix       text not null,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists idx_api_keys_user on api_keys (user_id, created_at desc);

-- Watermark scans on the source tables. These are small today (~50K, ~40K, ~150 rows) but the
-- materializer runs every 5 minutes, so give it an index to walk instead of a growing seq scan.
create index if not exists idx_thumbver_first_seen on thumbnail_versions (first_seen);
create index if not exists idx_title_versions_first_seen on title_versions (first_seen);
create index if not exists idx_video_scores_scored_at on video_scores (scored_at);
