-- Cut two measured sources of cold-read churn (2026-09-23, 10-minute pg_stat_statements diff:
-- the database read 4.5 GB, turning 512 MB of shared_buffers over roughly every 70 s).
--
-- 1. rss_latest: the newest rss_samples reading per video, trigger-maintained. rss-poll's
--    snapshot phase read the 2 GB rss_samples table once per feed video just to find its last
--    reading (LAST_SAMPLES_SQL, ~48 MB of cold reads per chunk). It now reads this ~10 MB table.
--    One row per video, never appended to: no retention decision needed beyond rss_samples'.
--    rss_samples rows are never updated in views/at (the only UPDATE path, the rss upsert, changes
--    conflicted/model_eligible), so insert and delete triggers keep it exact.
-- 2. videos_live_p0d_published_idx: drain-touch-queue's live-stream refresh
--    (duration = 'P0D' and published_at > now() - 30 days) walked 30 days of videos heap to find
--    ~100 rows: 369 MB per call.
--
-- Apply with psql. Part 1 is transactional; parts 2 and 3 must run outside a transaction.

begin;

create table if not exists public.rss_latest (
  video_id text primary key,
  at timestamptz not null,
  views bigint
);
alter table public.rss_latest enable row level security;
revoke all on table public.rss_latest from anon, authenticated;

create or replace function public.rss_latest_upserts()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.rss_latest (video_id, at, views)
  select distinct on (video_id) video_id, at, views
    from new_rows
   order by video_id, at desc
  on conflict (video_id) do update set at = excluded.at, views = excluded.views
   where excluded.at > public.rss_latest.at;
  return null;
end $$;

create or replace function public.rss_latest_deletes()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  with gone as (
    delete from public.rss_latest l
     using (select distinct video_id, at from old_rows) o
     where l.video_id = o.video_id and l.at = o.at
    returning l.video_id
  )
  insert into public.rss_latest (video_id, at, views)
  select g.video_id, s.at, s.views
    from gone g
    cross join lateral (
      select r.at, r.views from public.rss_samples r
       where r.video_id = g.video_id order by r.at desc limit 1
    ) s
  on conflict (video_id) do update set at = excluded.at, views = excluded.views
   where excluded.at > public.rss_latest.at;
  return null;
end $$;

revoke execute on function public.rss_latest_upserts(), public.rss_latest_deletes()
  from public, anon, authenticated;

drop trigger if exists rss_latest_insert on public.rss_samples;
create trigger rss_latest_insert after insert on public.rss_samples
  referencing new table as new_rows for each statement execute function public.rss_latest_upserts();
drop trigger if exists rss_latest_delete on public.rss_samples;
create trigger rss_latest_delete after delete on public.rss_samples
  referencing old table as old_rows for each statement execute function public.rss_latest_deletes();

commit;

-- Part 2: one-time backfill, after the triggers are live so concurrent writes converge
-- (newer reading wins on both paths). One sequential pass over rss_samples.
set statement_timeout = '15min';
set work_mem = '256MB';
set enable_indexscan = off;
set enable_bitmapscan = off;
insert into public.rss_latest (video_id, at, views)
select distinct on (video_id) video_id, at, views
  from public.rss_samples
 order by video_id, at desc
on conflict (video_id) do update set at = excluded.at, views = excluded.views
 where excluded.at > public.rss_latest.at;
reset enable_indexscan;
reset enable_bitmapscan;
reset work_mem;
analyze public.rss_latest;

-- Part 3: partial index for the live-stream refresh (no write lock).
create index concurrently if not exists videos_live_p0d_published_idx
  on public.videos (published_at) where duration = 'P0D';
reset statement_timeout;
