-- Bounded telemetry: one row per channel, overwritten on each successful feed response.
-- Retains latest response, last rejected response, accepted counts (<=15/feed), and
-- lifetime counters. Full response history is archived separately on worker disk.
create table public.rss_response_state (
  channel_id text primary key,
  state jsonb
);
alter table public.rss_response_state enable row level security;
revoke all on public.rss_response_state from public, anon, authenticated;
comment on table public.rss_response_state is
  'Worker-only RSS response freshness and cumulative measurement counters; one bounded row per channel.';

-- Metadata-only additions: legacy records keep legacy-fetch semantics; no historical rewrite.
alter table public.rss_samples
  add column time_basis text not null default 'legacy-fetch',
  add column received_at timestamptz,
  add column archive_ref text,
  add column model_eligible boolean not null default true,
  add column conflicted boolean not null default false;
