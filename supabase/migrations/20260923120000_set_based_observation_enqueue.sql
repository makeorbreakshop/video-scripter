-- Set-based rewrite of enqueue_observation_changes (queue semantics unchanged).
--
-- NOT A FIX FOR THE RSS FLUSH BUDGET. Measured 2026-09-23 (rolled-back transactions, same payload):
--   warm pages: old body ~0.11 ms/row, this body ~0.10 ms/row  (both already under 0.5 ms/row)
--   cold pages: either body ~2.5 ms/row; even a bare existence-checked change-log append ~1.2-1.5 ms/row
-- The trigger cost is buffer-cache misses, not jsonb or per-row SQL: the instance reads ~1 GB/min
-- from disk into a 512 MB shared_buffers, so every page a tick touched is evicted before the next
-- 5-minute tick. Covering indexes on videos / video_obs_cache / video_scores did not help either
-- (their pages are evicted too). Fixing the budget needs fewer cold pages on the insert path
-- (async fan-out) or less DB-wide read churn / more memory -- see the session notes.
--
-- What this version changes: payload parsed once; one videos_pkey probe per distinct video carrying
-- every column the queues need (old body probed videos 4x via three indexes); change log semi-joined
-- to that set; queue upserts fed in video_id order; video_obs_cache probe skipped when the video was
-- imported after capture start. Verified identical resulting state (log rows/order, obs/score/series
-- rows, generation relationships) against the old body on a mixed 1,903-row payload.
begin;

create or replace function public.enqueue_observation_changes(p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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
           now(), now()
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
$$;

revoke execute on function public.enqueue_observation_changes(jsonb) from public, anon, authenticated;

commit;
