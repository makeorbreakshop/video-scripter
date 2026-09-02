-- channel_meta: the YouTube channel's own identity (avatar, title, counts).
--
-- Populated from the channels.list response we already fetch when a user resolves or
-- tracks a channel (lib/app/channels.ts) — no extra YouTube units on that path — and
-- backfilled in batches of 50 ids per call (1 unit per call) by
-- scripts/channel-meta-backfill.ts.
--
-- This is deliberately separate from discovered_channels: that table is the ingest
-- registry and its rows are only written on discovery, while this one is refreshed and
-- is what the UI reads for avatars.

create table if not exists channel_meta (
  channel_id       text primary key,
  title            text,
  avatar_url       text,
  subscriber_count bigint,
  video_count      integer,
  fetched_at       timestamptz not null default now()
);

-- The backfill asks "which tracked channels have no meta / stale meta"; the UI asks for
-- a handful of ids at a time, which the primary key already serves.
create index if not exists idx_channel_meta_fetched_at on channel_meta (fetched_at);
