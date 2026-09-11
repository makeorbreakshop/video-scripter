begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

-- These tables contain only rebuildable queues/projections. Rows can predate the video catalog
-- cleanup that removed their parent, so remove those historical orphans before enforcing the
-- invariant. No source observations or score history are deleted here.
delete from public.observation_change_log x
 where not exists (select 1 from public.videos v where v.id=x.video_id);
delete from public.obs_cache_dirty x
 where not exists (select 1 from public.videos v where v.id=x.video_id);
delete from public.score_dirty x
 where not exists (select 1 from public.videos v where v.id=x.video_id);
delete from public.series_dirty x
 where not exists (select 1 from public.videos v where v.id=x.video_id);
delete from public.video_obs_cache x
 where not exists (select 1 from public.videos v where v.id=x.video_id);
delete from public.video_day30_truth x
 where not exists (select 1 from public.videos v where v.id=x.video_id);

alter table public.observation_change_log
  add constraint observation_change_log_video_id_fkey
  foreign key (video_id) references public.videos(id) on delete cascade not valid;
alter table public.obs_cache_dirty
  add constraint obs_cache_dirty_video_id_fkey
  foreign key (video_id) references public.videos(id) on delete cascade not valid;
alter table public.score_dirty
  add constraint score_dirty_video_id_fkey
  foreign key (video_id) references public.videos(id) on delete cascade not valid;
alter table public.series_dirty
  add constraint series_dirty_video_id_fkey
  foreign key (video_id) references public.videos(id) on delete cascade not valid;
alter table public.video_obs_cache
  add constraint video_obs_cache_video_id_fkey
  foreign key (video_id) references public.videos(id) on delete cascade not valid;
alter table public.video_day30_truth
  add constraint video_day30_truth_video_id_fkey
  foreign key (video_id) references public.videos(id) on delete cascade not valid;

alter table public.observation_change_log validate constraint observation_change_log_video_id_fkey;
alter table public.obs_cache_dirty validate constraint obs_cache_dirty_video_id_fkey;
alter table public.score_dirty validate constraint score_dirty_video_id_fkey;
alter table public.series_dirty validate constraint series_dirty_video_id_fkey;
alter table public.video_obs_cache validate constraint video_obs_cache_video_id_fkey;
alter table public.video_day30_truth validate constraint video_day30_truth_video_id_fkey;

commit;
