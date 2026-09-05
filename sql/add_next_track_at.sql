-- next_track_at: the per-video clock the due-based tracker drains (scripts/track-due.ts).
-- Additive. Replaces the date-grained next_track_date, which forced every video onto the
-- 3 AM batch boundary regardless of when it was actually published or last read.
--
--   next read = last read + the interval of the tier the video is in at that read
--   never read = published_at + that same interval  (so an old import is due immediately)
--
-- Mirrors lib/nightly/due-core.ts nextTrackAt(); the tier boundaries here and there must match
-- (DUE_TIER_BOUNDARIES = 30/180/730 days, intervals 1/3/7/14).
--
-- next_track_date is left in place and still written by the legacy paths
-- (lib/view-tracking-service.ts, lib/app/channels.ts); nothing reads it in the drain path.

alter table view_tracking_priority add column if not exists next_track_at timestamptz;

-- Partial: the drain only ever asks for `next_track_at <= now()`, which implies NOT NULL, so
-- the planner still gets an index-ordered scan and the index stays out of the backfill's way.
create index concurrently if not exists idx_vtp_next_track_at
  on view_tracking_priority (next_track_at)
  where next_track_at is not null;

-- Backfill is run in batches by scripts/apply-next-track-at.ts (1.01M rows; a single UPDATE
-- is an IO spike this database has been bitten by before). The batch statement is:
--
--   update view_tracking_priority p
--      set next_track_at = b.base + b.step
--     from (select p2.video_id,
--                  coalesce(p2.last_tracked::timestamptz, v.published_at) as base,
--                  case when age < 30 then interval '1 day' ... end as step
--             from view_tracking_priority p2 join videos v on v.id = p2.video_id
--            where p2.next_track_at is null
--            limit $1) b
--    where p.video_id = b.video_id;
