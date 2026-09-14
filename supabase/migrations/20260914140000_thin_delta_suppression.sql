-- Thinning: let the retention job delete archived duplicate readings without pushing a delete
-- delta through the Sep 11 event-driven queues, and record what each day was thinned to.
--
-- Why the suppression exists (full argument in docs/runbooks/2026-09-14-thin-deadlock.md and in
-- lib/readings/sql.ts THIN_SUPPRESS_DELTAS_SQL):
--
--   A thinning delete is not a correction. lib/readings/retention.ts keeps the last reading of
--   each bucket and the first reading of each (video, day, views>0) precisely so that every
--   derived value is unchanged — verified at 0 of 200 videos, max deviation 0.000 %. The obs
--   cache and the series files rebuild from the survivors to the same answer, so they do not
--   need to be told.
--
--   Telling them would cost 9.4 M rows appended to observation_change_log during a disk-pressure
--   emergency, and would mark the entire live corpus dirty in obs_cache_dirty, score_dirty and
--   series_dirty at once — a full corpus re-materialisation and re-score, which is the exact
--   unbounded raw-history traffic the 2026-09-11 egress rework was built to stop.
--
--   It also deadlocks. 2026-09-14 12:31 ET: the thinning delete and a live RSS insert reached
--   the same queue rows in different orders through these triggers. `deadlock detected`,
--   exit 1, nothing thinned.
--
-- Only the DELETE paths are guarded, and only for the two tables the retention job touches.
-- Inserts, updates and every snapshot path are untouched: real evidence changes must still
-- propagate. The flag is set with `set local`, so it is transaction-scoped, cannot leak past a
-- rollback or a crashed session, and needs no lock on a table the poller writes to continuously.

begin;

-- 1. The ledger learns what a day was thinned to, so the nightly run can tell a day that is
--    already at its tier from one that still needs walking. Re-walking rss 2026-09-03 to delete
--    nothing cost 3.5 minutes.
alter table public.readings_archive_days
  add column if not exists thinned_tier text
    check (thinned_tier is null or thinned_tier in ('hour','day')),
  add column if not exists thinned_rows bigint;

comment on column public.readings_archive_days.thinned_tier is
  'The retention tier this day was last reduced to, or null if never thinned.';
comment on column public.readings_archive_days.thinned_rows is
  'The Postgres row count the day was left at by that pass. Unchanged count + same tier = no-op.';

-- 2. The guard itself.
create or replace function public.thin_deltas_suppressed()
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(current_setting('channelsmith.suppress_observation_deltas', true), 'off')
         in ('on','true','1','yes')
$$;

create or replace function public.queue_rss_deletes()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  -- Archived retention thinning: the survivors are observationally equivalent, so there is
  -- nothing for the obs cache, the scorer or the series files to learn. See the header.
  if public.thin_deltas_suppressed() then return null; end if;
  perform public.enqueue_observation_changes((select jsonb_agg(jsonb_build_object(
    'video_id',video_id,'source','rss','operation','delete','at',at)) from old_rows));
  return null;
end $$;

create or replace function public.queue_sample_deletes()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if public.thin_deltas_suppressed() then return null; end if;
  perform public.enqueue_observation_changes((select jsonb_agg(jsonb_build_object(
    'video_id',video_id,'source','sample','operation','delete','at',sampled_at)) from old_rows));
  return null;
end $$;

revoke execute on function public.thin_deltas_suppressed() from public, anon, authenticated;

commit;
