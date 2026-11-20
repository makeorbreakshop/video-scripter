-- One RSS reading must fan out through the local trigger chain. Run inside a rolled-back tx:
--   psql -p 5434 -d channelsmith_pipeline -v ON_ERROR_STOP=1 -f sql/pipeline/smoke.sql
begin;
insert into videos (id, channel_id, title, published_at, import_date, duration, is_short, privacy_status, view_count, user_id)
  values ('__smoke__','UCsmoke','t', now() - interval '3 days', now(), 'PT10M', false, 'public', 10, gen_random_uuid());
insert into rss_samples (video_id, at, views, likes, time_basis, received_at, model_eligible, conflicted)
  values ('__smoke__', now(), 1234, 5, 'response-date-estimate', now(), true, false);
do $$ begin
  if (select views from rss_latest where video_id='__smoke__') is distinct from 1234 then raise exception 'rss_latest not maintained'; end if;
  if not exists (select 1 from observation_change_log where video_id='__smoke__') then raise exception 'no change_log row'; end if;
  if not exists (select 1 from obs_cache_dirty where video_id='__smoke__') then raise exception 'no obs_cache_dirty mark'; end if;
  if not exists (select 1 from score_dirty where video_id='__smoke__') then raise exception 'no score_dirty mark'; end if;
  if not exists (select 1 from series_dirty where video_id='__smoke__') then raise exception 'no series_dirty mark'; end if;
  raise notice 'pipeline smoke: ok';
end $$;
rollback;
