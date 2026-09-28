-- Materialisation cadence by video age (2026-09-28, P0 egress/WAL).
-- enqueue_observation_changes marked every video for a full obs-blob rewrite within 5 minutes of
-- each reading: the materializer returned ~5.7 GB/day of cached blobs to the client (billable
-- shared-pooler egress, traced) and the rewrites were ~40 % of all WAL (pg_walinspect). A mark now
-- waits least(score_cadence, 6 h) — videos under a day old still materialise within 5 minutes and
-- no video's cache refreshes less often than its score. Only the obs_queue not_before changed.
-- Rollback: sql/rollback/2026-09-28-materialization-cadence.sql
CREATE OR REPLACE FUNCTION public.enqueue_observation_changes(p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  affected integer;
begin
  if p_rows is null or jsonb_array_length(p_rows) = 0 then return; end if;
  with items as materialized (
    select x.video_id, x.source, x.operation, x.at, x.views, x.time_basis, x.received_at,
           coalesce(x.model_eligible, true) as model_eligible,
           coalesce(x.conflicted, false) as conflicted,
           item.position
      from jsonb_array_elements(p_rows) with ordinality as item(payload, position)
      cross join lateral jsonb_to_record(item.payload) as x(
        video_id text, source text, operation text, at timestamptz, views bigint,
        time_basis text, received_at timestamptz, model_eligible boolean, conflicted boolean)
     where x.video_id is not null and x.video_id <> '' and x.at is not null
  ), vids as materialized (
    -- The only videos read: one videos_pkey probe per distinct id, in index order.
    select v.id as video_id,
           coalesce(v.import_date >= m.capture_started_at, false) as imported_after_capture,
           (v.published_at is not null
             and coalesce(v.privacy_status,'public') = 'public'
             and coalesce(v.is_short,false) = false
             and coalesce(v.duration,'') <> 'P0D'
             and not (v.shorts_checked_at is null
                      and v.duration ~ '^PT[0-9HMS]+$'
                      and extract(epoch from v.duration::interval) <= 180)) as score_eligible,
           case
             when now() - v.published_at < interval '1 day' then interval '5 minutes'
             when now() - v.published_at < interval '7 days' then interval '1 hour'
             when now() - v.published_at < interval '30 days' then interval '1 day'
             when now() - v.published_at < interval '60 days' then interval '3 days'
             else interval '7 days'
           end as score_cadence
      from (select distinct video_id from items order by video_id) d
      join public.videos v on v.id = d.video_id
      cross join public.observation_materialization_meta m
     where m.singleton
  ), logged as (
    insert into public.observation_change_log
      (video_id, source, operation, at, views, time_basis, received_at, model_eligible, conflicted)
    select i.video_id, i.source, i.operation, i.at, i.views, i.time_basis, i.received_at,
           i.model_eligible, i.conflicted
      from items i
     where i.video_id in (select video_id from vids)
     order by i.position
    returning video_id, change_id
  ), per_video as materialized (
    select l.video_id, max(l.change_id) as generation
      from logged l group by l.video_id
  ), queued as materialized (
    select p.video_id, p.generation, v.imported_after_capture, v.score_eligible, v.score_cadence
      from per_video p join vids v using (video_id)
     order by p.video_id
  ), obs_queue as (
    insert into public.obs_cache_dirty(video_id, generation, requires_bootstrap, marked_at, not_before)
    select q.video_id, q.generation,
           not q.imported_after_capture
           and not exists (select 1 from public.video_obs_cache c
                            where c.video_id = q.video_id and c.format = 2),
           now(),
           -- Materialisation cadence (2026-09-28): least(score cadence, 6 h). Coalesces the
           -- readings of older videos into one blob rewrite; the least(...) on conflict below
           -- keeps the earliest due time, so a mark is never pushed later by a newer reading.
           now() + least(q.score_cadence, interval '6 hours')
      from queued q
     order by q.video_id
    on conflict (video_id) do update set
      generation = greatest(public.obs_cache_dirty.generation, excluded.generation),
      requires_bootstrap = public.obs_cache_dirty.requires_bootstrap or excluded.requires_bootstrap,
      marked_at = excluded.marked_at,
      not_before = least(public.obs_cache_dirty.not_before, excluded.not_before)
  ), score_queue as (
    insert into public.score_dirty(video_id, generation, reason, marked_at, not_before)
    select q.video_id, nextval('public.pipeline_generation_seq'), 'observation', now(),
           coalesce(sc.scored_at + q.score_cadence, now())
      from queued q
      left join public.video_scores sc on sc.video_id = q.video_id
     where q.score_eligible
     order by q.video_id
    on conflict (video_id) do update set
      generation = excluded.generation,
      reason = case when public.score_dirty.reason = 'model-rollout'
                    then public.score_dirty.reason else excluded.reason end,
      marked_at = excluded.marked_at,
      not_before = least(public.score_dirty.not_before, excluded.not_before)
  ), series_queue as (
    insert into public.series_dirty(video_id, marked_at, generation)
    select q.video_id, now(), nextval('public.pipeline_generation_seq')
      from queued q
     order by q.video_id
    on conflict (video_id) do update set
      marked_at = excluded.marked_at, generation = excluded.generation
  )
  select count(*) into affected from queued;
end;
$function$;
