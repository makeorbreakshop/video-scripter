-- Rollback for sql/2026-09-26-partition-video-score-history.sql, while video_score_history_unpartitioned
-- still exists. Moves any rows written since the migration back, swaps the names back, repoints the view.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '300s';
lock table public.video_score_history in share row exclusive mode;
insert into public.video_score_history_unpartitioned
  select * from public.video_score_history h
   where h.id > (select coalesce(max(id), 0) from public.video_score_history_unpartitioned);
alter sequence public.video_score_history_id_seq owned by public.video_score_history_unpartitioned.id;
alter table public.video_score_history rename to video_score_history_partitioned;
alter table public.video_score_history_unpartitioned rename to video_score_history;
create or replace view public.video_scores_by_version as
  select distinct on (h.video_id, h.model_version) h.id, h.video_id, h.channel_id, h.model_version,
         h.scored_at, h.age_days, h.views, h.score, h.same_age_ratio, h.typical_at_age, h.n_typical,
         h.typical_measured_share, h.projection, h.projection_horizon, h.est30, h.baseline,
         h.n_baseline, h.confidence, h.extra
    from public.video_score_history h
   order by h.video_id, h.model_version, h.scored_at desc;
commit;
-- Afterwards: drop table public.video_score_history_partitioned;   (takes its partitions with it)
