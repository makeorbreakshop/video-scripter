-- channel_directory: one row per channel we know about, built for the add-channel search.
--
-- Search used to be a prefix LIKE over three tables, so "iliketomakestuff" could not find
-- "I Like To Make Stuff" and "malecki" could not find "John Malecki". This view folds the
-- three registries (videos, discovered_channels, channels) into one row per channel with:
--   name        best title we have
--   norm        letters+digits only ("iliketomakestuff") — what a name looks like as a handle
--   handle      the @handle without the '@', lowercased, from channel_meta/channels/discovered
--   avatar_url  channel_meta first, then the legacy channels.thumbnail_url (4.6K of 4.7K rows)
--   subscriber_count  channel_meta, then channels, then discovered_channels
--   video_count videos we hold
--   tracked_lane 'user' | 'corpus' | null
-- pg_trgm gives typo tolerance (similarity) and fast ILIKE '%x%' via the GIN indexes.
--
-- A plain table, not a materialized view: the nightly ingest rebuilds it with one set-based
-- upsert (refresh_channel_directory(), one pass over videos), and enrolling a channel writes its
-- single row directly — no full rebuild per add (see the 2026-09-01 Disk-IO incident).
-- Apply with: npx tsx scripts/apply-sql.ts sql/channel-directory.sql

create extension if not exists pg_trgm;

-- Seed channel_meta from the legacy channels registry so avatars are there for every
-- channel we already paid for, without spending a YouTube unit. Idempotent.
insert into channel_meta (channel_id, title, avatar_url, subscriber_count, video_count, fetched_at)
select c.channel_id, c.channel_name, c.thumbnail_url, c.subscriber_count, c.video_count,
       coalesce(c.last_youtube_sync, c.updated_at, now())
  from channels c
 where c.channel_id like 'UC%' and c.thumbnail_url is not null
on conflict (channel_id) do update
   set avatar_url = coalesce(channel_meta.avatar_url, excluded.avatar_url),
       title      = coalesce(channel_meta.title, excluded.title);

create table if not exists channel_directory (
  channel_id   text primary key,
  name         text not null,
  norm         text not null,
  handle       text,
  avatar_url   text,
  subscriber_count bigint,
  video_count  integer not null default 0,
  tracked_lane text,
  refreshed_at timestamptz not null default now()
);
alter table channel_directory add column if not exists subscriber_count bigint;
create index if not exists idx_channel_directory_name_trgm on channel_directory using gin (name gin_trgm_ops);
create index if not exists idx_channel_directory_norm_trgm on channel_directory using gin (norm gin_trgm_ops);
create index if not exists idx_channel_directory_norm on channel_directory (norm text_pattern_ops);
create index if not exists idx_channel_directory_handle on channel_directory (handle);

-- One set-based statement (not row-by-row PL/pgSQL): rebuilds every row from the registries.
create or replace function refresh_channel_directory() returns integer language sql as $fn$
  with upserted as (
    insert into channel_directory (channel_id, name, norm, handle, avatar_url, subscriber_count, video_count, tracked_lane, refreshed_at)
    select channel_id, name, norm, handle, avatar_url, subscriber_count, video_count, tracked_lane, now() from (
      with vid as (
        -- one hash-aggregate pass over videos (857K rows) instead of a sort: name + count per channel
        select channel_id, max(channel_name) as name, count(*)::int as n
          from videos where channel_id like 'UC%' group by channel_id
      ),
      names as (
        select channel_id, title as name, 0 as pri from channel_meta where channel_id like 'UC%' and title is not null
        union all
        select channel_id, channel_name, 1 from channels where channel_id like 'UC%' and channel_name is not null
        union all
        select channel_id, channel_title, 2 from discovered_channels where channel_id like 'UC%' and channel_title is not null
        union all
        select channel_id, name, 3 from vid where name is not null
      ),
      best as (
        select distinct on (channel_id) channel_id, name from names order by channel_id, pri
      ),
      handles as (
        select channel_id, lower(regexp_replace(h, '^.*@', '')) as handle from (
          select channel_id, coalesce(channel_handle, custom_url) as h from channels
          union all
          select channel_id, coalesce(channel_handle, custom_url) from discovered_channels
        ) x where h is not null and h <> ''
      )
      select b.channel_id,
             b.name,
             lower(regexp_replace(b.name, '[^A-Za-z0-9]', '', 'g')) as norm,
             (select min(h.handle) from handles h where h.channel_id = b.channel_id) as handle,
             coalesce(cm.avatar_url, c.thumbnail_url) as avatar_url,
             coalesce(cm.subscriber_count, c.subscriber_count, dc.subscriber_count) as subscriber_count,
             coalesce(vc.n, 0) as video_count,
             case when ct.lane is not null then ct.lane
                  when cy.youtube_channel_id is not null then 'corpus'
                  when vc.n > 0 then 'corpus'
                  else null end as tracked_lane
        from best b
        left join channel_meta cm on cm.channel_id = b.channel_id
        left join channels c on c.channel_id = b.channel_id
        left join discovered_channels dc on dc.channel_id = b.channel_id
        left join vid vc on vc.channel_id = b.channel_id
        left join channel_tracking ct on ct.channel_id = b.channel_id
        left join competitor_youtube_channels cy on cy.youtube_channel_id = b.channel_id
    ) src
    on conflict (channel_id) do update
      set name = excluded.name, norm = excluded.norm,
          handle = coalesce(excluded.handle, channel_directory.handle),
          avatar_url = coalesce(excluded.avatar_url, channel_directory.avatar_url),
          subscriber_count = coalesce(excluded.subscriber_count, channel_directory.subscriber_count),
          video_count = excluded.video_count, tracked_lane = excluded.tracked_lane,
          refreshed_at = now()
    returning 1
  )
  select count(*)::int from upserted;
$fn$;

select refresh_channel_directory();
