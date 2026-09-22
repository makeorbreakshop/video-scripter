-- Run lease for the hourly semantic sync (scripts/semantic/sync-semantic.ts).
-- Replaces a session-scoped pg advisory lock that could be stranded on a Supavisor pooled backend
-- when the process died, after which every later run skipped silently. One row per job name;
-- expires_at is refreshed by heartbeat and an expired row may be taken over atomically.
create table if not exists public.semantic_sync_lease (
  name         text primary key,
  holder       text not null,
  acquired_at  timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at   timestamptz not null
);

comment on table public.semantic_sync_lease is
  'Pooler-safe run leases for scheduled semantic jobs. Live while expires_at > now(); stale rows are taken over or cleared with --break-stale-lock.';
