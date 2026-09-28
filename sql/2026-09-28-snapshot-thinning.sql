-- view_snapshots thinning (approved 2026-09-28). Applied once, on the session pooler.
--
-- 1. Snapshot deletes honour the same transaction-local suppression the readings thinning uses
--    (sql/2026-09-14 thin_delta_suppression, lib/readings/sql.ts THIN_SUPPRESS_DELTAS_SQL): a thinned
--    snapshot is not a correction, and propagating ~372 K deletes would append them to
--    observation_change_log and mark ~600 K videos dirty — the Sep 11 egress incident again.
--    refresh_day30_truth is skipped too: the policy never removes a snapshot of a video's first 30 days.
-- 2. The archive ledger accepts source 'snapshots' and tier 'snap-v1'.
begin;
set local lock_timeout = '5s';
create or replace function public.queue_snapshot_deletes()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
begin
  if public.thin_deltas_suppressed() then return null; end if;
  perform public.enqueue_observation_changes((select jsonb_agg(jsonb_build_object(
    'video_id',video_id,'source','snapshot','operation','delete',
    'at',snapshot_date::timestamptz + interval '12 hours')) from old_rows));
  perform public.refresh_day30_truth(array(select distinct video_id from old_rows));
  return null;
end $function$;

alter table readings_archive_days drop constraint if exists readings_archive_days_source_check;
alter table readings_archive_days add constraint readings_archive_days_source_check
  check (source in ('rss','api','history','snapshots'));
alter table readings_archive_days drop constraint if exists readings_archive_days_thinned_tier_check;
alter table readings_archive_days add constraint readings_archive_days_thinned_tier_check
  check (thinned_tier is null or thinned_tier in ('hour','day','day-v2','week-v2','snap-v1'));
commit;
