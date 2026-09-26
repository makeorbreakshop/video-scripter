-- Repoint the database objects that read videos.metadata at video_text. AWAITING APPROVAL.
--
-- Precondition for adding `metadata` to CLEARED_COLUMNS (lib/app/video-text-move.ts):
-- lib/app/video-text-db-objects.db.test.ts fails while a live database object still reads
-- videos.metadata. Each object below reads `coalesce(vt.metadata, v.metadata)` afterwards — correct
-- before and after the null-out, exactly like the code accessor (lib/app/video-text.ts).
--
-- competitor_youtube_channels is the one that matters: live ingest reads it to decide which channels
-- are tracked (lib/nightly/priority-lane.ts, scripts/nightly-ingest.ts, drain-touch-queue.ts,
-- extension-api-server.ts). It has NOT been refreshed since ~2025-07-31 (818 rows). Recreating it
-- WITH DATA would silently change what ingest tracks (and its quota), so it is FROZEN instead: the
-- current 818 rows become a plain table with the same name, columns, unique index and grants.
-- Whether it should be refreshed at all is a separate product decision.
--
-- The three dashboard matviews are recreated WITH DATA (each scans `videos` once: ~1-3 min each;
-- readers of THAT matview wait, nothing else does). Run on the session pooler:
--   psql "$DATABASE_SESSION_URL" -v ON_ERROR_STOP=1 -f sql/2026-09-26-metadata-db-readers.sql

-- 1. The live-ingest tracked-channel list: freeze as a table, contents unchanged.
begin;
set local lock_timeout = '5s';
create table public.competitor_youtube_channels_frozen as select * from public.competitor_youtube_channels;
drop materialized view public.competitor_youtube_channels;
alter table public.competitor_youtube_channels_frozen rename to competitor_youtube_channels;
create unique index competitor_youtube_channels_youtube_channel_id_idx on public.competitor_youtube_channels (youtube_channel_id);
revoke all on public.competitor_youtube_channels from anon, authenticated;
grant all on public.competitor_youtube_channels to service_role, channelsmith_app;
commit;

-- 2. Functions: same signatures and settings, metadata through video_text.
create or replace function public.get_competitor_channel_stats()
 returns table(channel_id text, youtube_channel_id text, channel_name text, channel_title text, channel_handle text,
               subscriber_count bigint, video_count bigint, last_import timestamp with time zone, channel_thumbnail text)
 language plpgsql
 set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
begin
  return query
  with channel_aggregates as (
    select v.channel_id,
           count(*) as video_count,
           max(v.import_date) as last_import,
           (array_agg(coalesce(vt.metadata, v.metadata) order by
              case when coalesce(vt.metadata, v.metadata)->'channel_stats' is not null then 0 else 1 end,
              v.import_date desc))[1] as best_metadata
      from videos v
      left join video_text vt on vt.video_id = v.id
     where v.is_competitor = true
     group by v.channel_id
  )
  select ca.channel_id::text,
         coalesce(ca.best_metadata->>'youtube_channel_id', ca.channel_id)::text,
         coalesce(ca.best_metadata->>'channel_name', ca.best_metadata->>'channel_title', ca.channel_id)::text,
         (ca.best_metadata->>'channel_title')::text,
         (ca.best_metadata->>'channel_handle')::text,
         coalesce(case when ca.best_metadata->'channel_stats'->'subscriber_count' is not null
                       then (ca.best_metadata->'channel_stats'->'subscriber_count')::text::bigint else 0 end, 0)::bigint,
         ca.video_count::bigint,
         ca.last_import,
         (ca.best_metadata->'channel_stats'->>'channel_thumbnail')::text
    from channel_aggregates ca;
end;
$function$;

create or replace function public.get_random_video_ids(p_outlier_score integer default 2, p_min_views integer default 1000,
  p_days_ago integer default 90, p_domain text default null::text, p_sample_size integer default 500, p_category text default null::text)
 returns table(video_id text)
 language plpgsql
 stable parallel safe
 set random_page_cost to '1.1'
 set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
begin
  return query
  select v.id
    from videos v
    left join video_text vt on vt.video_id = v.id
   where v.temporal_performance_score >= p_outlier_score
     and v.temporal_performance_score <= 100
     and v.view_count >= p_min_views
     and v.published_at >= now() - (p_days_ago || ' days')::interval
     and v.is_short = false
     and v.is_institutional = false
     and (p_domain is null or v.topic_domain = p_domain)
     and (p_category is null or p_category = 'all' or coalesce(vt.metadata, v.metadata)->>'category_id' = p_category)
   limit p_sample_size * 2;
end;
$function$;

-- 3. Dashboard matviews: recreated over video_text, one transaction each.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20min'; -- WITH DATA scans videos; the 2 min role default cancelled database_channel_health on 2026-09-26
drop materialized view public.competitor_channel_summary;
create materialized view public.competitor_channel_summary as
  with channel_aggregates as (
    select v.channel_id, count(*) as video_count, max(v.import_date) as last_import,
           (array_agg(coalesce(vt.metadata, v.metadata) order by
              case when (coalesce(vt.metadata, v.metadata) -> 'channel_stats') is not null then 0 else 1 end,
              v.import_date desc))[1] as best_metadata
      from videos v left join video_text vt on vt.video_id = v.id
     where v.is_competitor = true
     group by v.channel_id
  )
  select ca.channel_id,
         coalesce(ca.best_metadata ->> 'youtube_channel_id', ca.channel_id) as youtube_channel_id,
         coalesce(ca.best_metadata ->> 'channel_name', ca.best_metadata ->> 'channel_title', ca.channel_id) as channel_name,
         ca.best_metadata ->> 'channel_title' as channel_title,
         ca.best_metadata ->> 'channel_handle' as channel_handle,
         coalesce(case
           when ((ca.best_metadata -> 'channel_stats') -> 'subscriber_count') is null then 0
           when ((ca.best_metadata -> 'channel_stats') ->> 'subscriber_count') = '' then 0
           when ((ca.best_metadata -> 'channel_stats') ->> 'subscriber_count') !~ '^\d+$' then 0
           else (((ca.best_metadata -> 'channel_stats') ->> 'subscriber_count')::bigint)::integer end, 0) as subscriber_count,
         ca.video_count::integer as video_count,
         ca.last_import,
         (ca.best_metadata -> 'channel_stats') ->> 'channel_thumbnail' as channel_thumbnail
    from channel_aggregates ca;
create index idx_competitor_channel_summary_channel_id on public.competitor_channel_summary (channel_id);
create index idx_competitor_channel_summary_subscriber_count on public.competitor_channel_summary (subscriber_count);
revoke all on public.competitor_channel_summary from anon, authenticated;
grant all on public.competitor_channel_summary to service_role, channelsmith_app;
commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '20min'; -- WITH DATA scans videos; the 2 min role default cancelled database_channel_health on 2026-09-26
drop materialized view public.analytics_stats;
create materialized view public.analytics_stats as
  with video_stats as (
    select count(*) as total_videos,
           count(*) filter (where videos.is_competitor = true) as competitor_videos,
           count(*) filter (where videos.pinecone_embedded = true) as embedded_videos,
           count(*) filter (where videos.created_at >= (now() - '30 days'::interval)) as recent_videos,
           round(avg(videos.view_count), 0) as average_views
      from videos
  ), channel_stats as (
    select count(distinct videos.channel_id) as total_channels,
           count(distinct videos.channel_id) filter (where videos.is_competitor = true) as competitor_channels
      from videos where videos.channel_id is not null
  ), rss_stats as (
    select count(distinct v.channel_id) as rss_monitored_channels
      from videos v left join video_text vt on vt.video_id = v.id
     where v.is_competitor = true and v.channel_id is not null
       and ((coalesce(vt.metadata, v.metadata) ->> 'youtube_channel_id') ~~ 'UC%'
            or (coalesce(vt.metadata, v.metadata) ->> 'source') = 'rss'
            or (coalesce(vt.metadata, v.metadata) ->> 'import_method') = 'rss')
  )
  select v.total_videos, c.total_channels, v.competitor_videos, c.competitor_channels,
         coalesce(r.rss_monitored_channels, 0::bigint) as rss_monitored_channels,
         v.embedded_videos, v.recent_videos, v.average_views
    from video_stats v cross join channel_stats c cross join rss_stats r;
create unique index analytics_stats_single_row on public.analytics_stats ((1));
revoke all on public.analytics_stats from anon, authenticated;
grant all on public.analytics_stats to service_role, channelsmith_app;
commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '20min'; -- WITH DATA scans videos; the 2 min role default cancelled database_channel_health on 2026-09-26
drop materialized view public.database_channel_health;
create materialized view public.database_channel_health as
  with channel_activity as (
    select count(distinct videos.channel_id) filter (where videos.channel_id in (
             select distinct videos_1.channel_id from videos videos_1
              where videos_1.published_at >= (current_date - '30 days'::interval))) as active_channels_30d,
           count(distinct videos.channel_id) as total_channels
      from videos where videos.channel_id is not null
  ), channel_sizes as (
    select case when channel_subs.subscriber_count < 10000 then 'Small (<10K)'
                when channel_subs.subscriber_count < 100000 then 'Medium (10K-100K)'
                when channel_subs.subscriber_count < 1000000 then 'Large (100K-1M)'
                else 'Mega (>1M)' end as size_category,
           count(*) as channel_count
      from (select v.channel_id,
                   max(((coalesce(vt.metadata, v.metadata) -> 'channel_stats') ->> 'subscriber_count')::integer) as subscriber_count
              from videos v left join video_text vt on vt.video_id = v.id
             where v.channel_id is not null
               and ((coalesce(vt.metadata, v.metadata) -> 'channel_stats') ->> 'subscriber_count') is not null
               and ((coalesce(vt.metadata, v.metadata) -> 'channel_stats') ->> 'subscriber_count') ~ '^\d+$'
             group by v.channel_id) channel_subs
     group by 1
  )
  select ca.active_channels_30d, ca.total_channels,
         round(ca.active_channels_30d::numeric * 100.0 / nullif(ca.total_channels, 0)::numeric, 1) as active_percent,
         jsonb_object_agg(cs.size_category, cs.channel_count) as channel_size_distribution,
         now() as last_updated
    from channel_activity ca cross join channel_sizes cs
   group by ca.active_channels_30d, ca.total_channels;
create unique index idx_database_channel_health_refresh on public.database_channel_health (last_updated);
revoke all on public.database_channel_health from anon, authenticated;
grant all on public.database_channel_health to service_role, channelsmith_app;
commit;
