-- Title/description change vs. sync (2026-09-03, after the first full-corpus RSS pass).
--
-- The poller compared each feed title against videos.title and called every difference a CHANGE.
-- For a video we had never looked at before, that is wrong: the title may have changed any time
-- in the past year and we simply had not looked. The first pass emitted 708 title_change feed
-- events, 329 of them on videos older than six months, and re-entered 447 videos into the
-- 5-minute stats ladder.
--
-- A difference is only a CHANGE if we have recent evidence of the OLD title. That evidence has
-- to be recorded explicitly: videos.updated_at is bumped by duration refreshes and by the title
-- write itself, and track_schedule.last_title_check only ever covered videos under 30 days.

-- When any detector last OBSERVED this video's title, whether or not it differed.
alter table videos add column if not exists title_observed_at timestamptz;
create index if not exists idx_videos_title_observed on videos (title_observed_at);

-- A backfill row is a first observation (or a sync of a title that drifted while we were not
-- looking), not a change: no feed event, no stats-lane re-entry.
alter table title_versions add column if not exists backfill boolean not null default false;
alter table description_versions add column if not exists backfill boolean not null default false;

-- Seed the new column from the evidence that does exist: track_schedule.last_title_check is a
-- genuine title observation (launch-track's RSS pass and the poller both wrote it), and a
-- title_versions row is an observation by definition. Two passes, each driven off a small table,
-- rather than one join with a per-row lateral (this DB has had IO incidents).
set statement_timeout = 0;

update videos v set title_observed_at = s.last_title_check
  from track_schedule s
 where s.video_id = v.id and s.last_title_check is not null and v.title_observed_at is null;

update videos v set title_observed_at = greatest(v.title_observed_at, t.last_seen)
  from (select video_id, max(first_seen) as last_seen from title_versions group by video_id) t
 where t.video_id = v.id and t.last_seen is not null;
