-- ChannelSmith app schema: users, their tracked channels, per-channel tracking
-- lane, and the paced backfill queue. Idempotent — safe to re-run.
-- Applied with: set -a; . ./.env.local; set +a; psql "$DATABASE_URL" -f sql/app-users.sql

-- Clerk-backed application users. clerk_id is the join key from the session.
create table if not exists app_users (
  id         uuid primary key default gen_random_uuid(),
  clerk_id   text not null unique,
  email      text,
  plan       text not null default 'free',
  created_at timestamptz not null default now()
);
create index if not exists idx_app_users_clerk_id on app_users (clerk_id);

-- Which channels a user tracks. role 'self' = their own channel.
create table if not exists user_channels (
  user_id         uuid not null references app_users(id) on delete cascade,
  channel_id      text not null,
  role            text not null default 'competitor',
  watched_closely boolean not null default false,
  added_at        timestamptz not null default now(),
  primary key (user_id, channel_id)
);
alter table user_channels drop constraint if exists user_channels_role_check;
alter table user_channels add constraint user_channels_role_check
  check (role in ('self','competitor'));
create index if not exists idx_user_channels_channel on user_channels (channel_id);
create index if not exists idx_user_channels_user_added on user_channels (user_id, added_at desc);

-- Lane promotion: 'corpus' is the cheap default sampling, 'user' is the dense
-- user-tracked lane. One row per channel.
create table if not exists channel_tracking (
  channel_id      text primary key,
  lane            text not null default 'corpus',
  promoted_at     timestamptz,
  backfill_status text not null default 'none',
  backfill_depth  integer
);
alter table channel_tracking drop constraint if exists channel_tracking_lane_check;
alter table channel_tracking add constraint channel_tracking_lane_check
  check (lane in ('corpus','user'));
alter table channel_tracking drop constraint if exists channel_tracking_backfill_status_check;
alter table channel_tracking add constraint channel_tracking_backfill_status_check
  check (backfill_status in ('none','queued','running','done','failed'));
create index if not exists idx_channel_tracking_lane on channel_tracking (lane);
create index if not exists idx_channel_tracking_backfill_status on channel_tracking (backfill_status);

-- Paced work queue drained by scripts/backfill-catalog.ts.
create table if not exists backfill_jobs (
  id           bigserial primary key,
  channel_id   text not null,
  kind         text not null,
  status       text not null default 'queued',
  requested_at timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  units_spent  integer not null default 0,
  error        text
);
alter table backfill_jobs drop constraint if exists backfill_jobs_kind_check;
alter table backfill_jobs add constraint backfill_jobs_kind_check
  check (kind in ('catalog','snapshots'));
alter table backfill_jobs drop constraint if exists backfill_jobs_status_check;
alter table backfill_jobs add constraint backfill_jobs_status_check
  check (status in ('queued','running','done','failed'));
create index if not exists idx_backfill_jobs_queue on backfill_jobs (status, requested_at);
create index if not exists idx_backfill_jobs_channel on backfill_jobs (channel_id, kind);
-- At most one open job per (channel, kind); re-queueing is a no-op.
create unique index if not exists idx_backfill_jobs_open_unique
  on backfill_jobs (channel_id, kind) where status in ('queued','running');

-- Channel search: pg_trgm is not installed on this database, so searchTracked()
-- uses case-insensitive PREFIX match. These pattern_ops indexes make that
-- indexable (the default collation cannot use a plain btree for LIKE 'x%').
create index if not exists idx_videos_channel_name_lower_pattern
  on videos (lower(channel_name) text_pattern_ops);
create index if not exists idx_discovered_channels_title_lower_pattern
  on discovered_channels (lower(channel_title) text_pattern_ops);

-- User-tracked videos are tagged data_source 'user' (distinct from the corpus's
-- 'competitor' rows) so the two lanes stay separable. Widen the existing check.
alter table videos drop constraint if exists videos_data_source_check;
alter table videos add constraint videos_data_source_check
  check (data_source = any (array['owner','competitor','user'])) not valid;
-- Superset of the previously-validated constraint, so every existing row
-- conforms; validating is a cheap non-blocking confirmation.
alter table videos validate constraint videos_data_source_check;
