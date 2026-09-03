-- Ownership boundary for owner-only YouTube analytics.
--
-- Every row in daily_analytics comes from a creator's private Analytics API grant. Until now
-- the table was keyed by video_id alone, so nothing recorded which creator the numbers
-- belonged to. This adds that ownership, an index to make scoping cheap, and RLS policies.
--
-- IMPORTANT: the app currently connects as `postgres`, which has BYPASSRLS, so these
-- policies do NOT take effect yet — they would be silently skipped. They are here so the
-- boundary is already defined for the day the app connects as the restricted role created
-- in sql/analytics-restricted-role.sql. The control that actually enforces access today is
-- lib/app/analytics-privacy.ts, which refuses to read without a user id.
--
-- Apply with: npx tsx scripts/apply-sql.ts sql/analytics-privacy.sql

alter table daily_analytics add column if not exists channel_id text;

-- Backfill from the video the row belongs to.
update daily_analytics d
   set channel_id = v.channel_id
  from videos v
 where v.id = d.video_id and d.channel_id is distinct from v.channel_id;

create index if not exists idx_daily_analytics_channel on daily_analytics (channel_id, date);

-- Keep it populated for future inserts even if a caller forgets.
create or replace function daily_analytics_set_channel() returns trigger language plpgsql as $$
begin
  if new.channel_id is null then
    select v.channel_id into new.channel_id from videos v where v.id = new.video_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_daily_analytics_channel on daily_analytics;
create trigger trg_daily_analytics_channel before insert or update on daily_analytics
  for each row execute function daily_analytics_set_channel();

-- Defence in depth. Inert while the connecting role has BYPASSRLS.
alter table daily_analytics enable row level security;
alter table daily_analytics force row level security;
drop policy if exists daily_analytics_owner_read on daily_analytics;
create policy daily_analytics_owner_read on daily_analytics for select
  using (exists (
    select 1 from youtube_connections yc
     where yc.channel_id = daily_analytics.channel_id
       and yc.user_id::text = current_setting('app.user_id', true)
  ));

alter table youtube_connections enable row level security;
alter table youtube_connections force row level security;
drop policy if exists youtube_connections_owner on youtube_connections;
create policy youtube_connections_owner on youtube_connections for all
  using (user_id::text = current_setting('app.user_id', true));

-- The writers (nightly sync, backfill) run as a trusted job, not as a person.
drop policy if exists daily_analytics_service_write on daily_analytics;
create policy daily_analytics_service_write on daily_analytics for all
  using (current_setting('app.service', true) = 'on')
  with check (current_setting('app.service', true) = 'on');
