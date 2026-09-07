-- Bounded telemetry: one row per channel, overwritten on each successful feed response.
-- Retains latest response, last rejected response, accepted counts (<=15/feed), and
-- lifetime counters; no append-only response history or retention scan.
create table public.rss_response_state (
  channel_id text primary key,
  state jsonb
);
alter table public.rss_response_state enable row level security;
revoke all on public.rss_response_state from public, anon, authenticated;
comment on table public.rss_response_state is
  'Worker-only RSS response freshness and cumulative measurement counters; one bounded row per channel.';
