-- Rollback for the 2026-09-08 index drops (§6-4 of the database performance investigation).
-- Definitions captured from pg_get_indexdef BEFORE dropping. Re-create CONCURRENTLY.
--
-- Dropped: idx_scan counts are since the 2026-09-04 pg_stat reset (4 days).
CREATE INDEX CONCURRENTLY idx_videos_age_confidence ON public.videos USING btree (age_confidence);                                  -- 40 MB, 3 scans
CREATE INDEX CONCURRENTLY idx_video_scores_ratio ON public.video_scores USING btree (same_age_ratio DESC NULLS LAST);               -- 30 MB, 5 scans
CREATE INDEX CONCURRENTLY idx_videos_need_bertopic ON public.videos USING btree (id) WHERE (bertopic_version IS NULL);              -- 26 MB, 2 scans

-- NOT dropped, and why (the 09-08 audit listed these; re-measuring 2026-09-08 contradicts it):
--   idx_view_snapshots_video_date          30,068,974 scans — the hottest index in the database,
--                                          not a dead prefix. Dropping it would be an outage.
--   idx_view_snapshots_date_video          19,249 scans — actively used.
--   video_score_history_pkey               0 scans, but lib/readings/sql.ts:183 deletes
--                                          `where h.id = d.id`; retention only started today, so
--                                          the zero is stats age, not deadness.
--   idx_videos_channel_views               32 scans but serves app/api/v1/channels/[id]/videos
--                                          over 1.1 M rows on a cache-starved instance.
--   idx_view_tracking_priority_tier_date   32 scans but serves lib/nightly/due-core.ts.
--   idx_videos_competitor_metadata         44 scans, live discovery paths.
