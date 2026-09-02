-- youtube_connections: a user's OAuth grant for a channel they own, so we can read the
-- owner-only YouTube Analytics (per-day views, average view duration, subscribers gained,
-- traffic sources) that public data never shows. One row per (user, channel). The refresh
-- token is the secret; access tokens are minted on demand and never stored.
-- Apply with: npx tsx scripts/apply-sql.ts sql/youtube-connections.sql
create table if not exists youtube_connections (
  user_id        uuid not null references app_users(id) on delete cascade,
  channel_id     text not null,
  channel_title  text,
  refresh_token  text not null,
  scopes         text[] not null default '{}',
  connected_at   timestamptz not null default now(),
  last_synced_at timestamptz,
  last_error     text,
  primary key (user_id, channel_id)
);
create index if not exists idx_youtube_connections_channel on youtube_connections (channel_id);
