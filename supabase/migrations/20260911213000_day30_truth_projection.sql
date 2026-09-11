begin;

-- Follow-up for databases that already applied 20260911153000. Scheduled scoring previously
-- reached back into view_snapshots for each prior's exact day-30 anchor after a compact-cache
-- hit. This narrow projection is backfilled server-side once and maintained by the existing
-- snapshot statement triggers, so no raw history crosses the wire during scoring.
create table if not exists public.video_day30_truth (
  video_id text primary key,
  snapshot_day integer not null,
  snapshot_date date not null,
  views bigint not null
);
alter table public.video_day30_truth enable row level security;
revoke all on table public.video_day30_truth from anon, authenticated;

create or replace function public.refresh_day30_truth(p_video_ids text[])
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_video_ids is null or cardinality(p_video_ids) = 0 then return; end if;
  delete from public.video_day30_truth where video_id=any(p_video_ids);
  insert into public.video_day30_truth(video_id,snapshot_day,snapshot_date,views)
  select distinct on (s.video_id)
         s.video_id, s.days_since_published, s.snapshot_date, s.view_count
    from public.view_snapshots s
   where s.video_id=any(p_video_ids)
     and s.days_since_published between 27 and 33
     and s.view_count > 0
   order by s.video_id, abs(s.days_since_published - 30), s.snapshot_date desc;
end $$;

create or replace function public.queue_snapshot_upserts()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform public.enqueue_observation_changes((select jsonb_agg(jsonb_build_object(
    'video_id',video_id,'source','snapshot','operation','upsert',
    'at',snapshot_date::timestamptz + interval '12 hours','views',view_count)) from new_rows));
  perform public.refresh_day30_truth(array(select distinct video_id from new_rows));
  return null;
end $$;

create or replace function public.queue_snapshot_deletes()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform public.enqueue_observation_changes((select jsonb_agg(jsonb_build_object(
    'video_id',video_id,'source','snapshot','operation','delete',
    'at',snapshot_date::timestamptz + interval '12 hours')) from old_rows));
  perform public.refresh_day30_truth(array(select distinct video_id from old_rows));
  return null;
end $$;

create or replace function public.queue_snapshot_updates()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform public.enqueue_observation_changes((select jsonb_agg(payload order by phase) from (
    select jsonb_build_object(
      'video_id',video_id,'source','snapshot','operation','delete',
      'at',snapshot_date::timestamptz + interval '12 hours') as payload, 0 as phase from old_rows
    union all
    select jsonb_build_object(
      'video_id',video_id,'source','snapshot','operation','upsert',
      'at',snapshot_date::timestamptz + interval '12 hours','views',view_count), 1 from new_rows
  ) changes));
  perform public.refresh_day30_truth(array(
    select video_id from old_rows union select video_id from new_rows
  ));
  return null;
end $$;

revoke execute on function public.refresh_day30_truth(text[]) from public, anon, authenticated;

insert into public.video_day30_truth(video_id,snapshot_day,snapshot_date,views)
select distinct on (s.video_id)
       s.video_id, s.days_since_published, s.snapshot_date, s.view_count
  from public.view_snapshots s
 where s.days_since_published between 27 and 33 and s.view_count > 0
 order by s.video_id, abs(s.days_since_published - 30), s.snapshot_date desc
on conflict (video_id) do update set
  snapshot_day=excluded.snapshot_day,
  snapshot_date=excluded.snapshot_date,
  views=excluded.views;

commit;
