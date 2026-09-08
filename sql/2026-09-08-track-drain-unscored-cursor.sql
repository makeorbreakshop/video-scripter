-- A cursor for track-drain's "which user-lane channel still has unscored old videos" sweep.
--
-- That EXISTS cost 34,578 shared blocks and 24 s per call, every fifteen minutes, because a
-- channel that is ALREADY fully scored forces the subquery to examine its whole catalogue before
-- it can answer "no", and no index can shortcut an anti-join against video_scores. With this
-- column the sweep examines 20 channels a run, oldest check first, so every user-lane channel is
-- still looked at within a day and the per-run cost is bounded.
alter table channel_tracking add column if not exists unscored_checked_at timestamptz;

comment on column channel_tracking.unscored_checked_at is
  'When scripts/track-drain.ts last checked this channel for unscored videos older than 60 days.';
