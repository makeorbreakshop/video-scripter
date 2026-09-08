-- Applied 2026-09-08 against mhzwrynnfphlxqcqytrj. §6 items 4, 5 and 6 of
-- ~/shared-memory/knowledge/projects/video-scripter/2026-09-08-database-performance-investigation.md
--
-- Rollback for the drops: sql/rollback/2026-09-08-dropped-indexes.sql (definitions captured first).
-- The audit's §6-4 list was re-measured before acting and SEVEN of its ten entries were rejected;
-- the rollback file records each rejection and its evidence. Most important: the audit calls
-- idx_view_snapshots_video_date a dead prefix, but it has 30,068,974 scans and is the hottest
-- index in the database.

DROP INDEX CONCURRENTLY IF EXISTS public.idx_videos_age_confidence;   -- 40 MB, 3 scans, no code reference
DROP INDEX CONCURRENTLY IF EXISTS public.idx_video_scores_ratio;      -- 30 MB, 5 scans, nothing orders by same_age_ratio
DROP INDEX CONCURRENTLY IF EXISTS public.idx_videos_need_bertopic;    -- 26 MB, 2 scans, bertopic pipeline is dead

-- Per-table autovacuum. reloptions was null on every table, so everything ran at the 0.2 default:
-- view_snapshots needed 570 K dead tuples to trigger, sat at 448,910, and had not been vacuumed
-- since 09-05 — one large badly-timed IO event on a 2 GB instance instead of many small ones.
ALTER TABLE view_snapshots         SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE view_tracking_priority SET (autovacuum_vacuum_scale_factor = 0.05, fillfactor = 85);
ALTER TABLE videos                 SET (autovacuum_vacuum_scale_factor = 0.05, fillfactor = 85);
ALTER TABLE video_scores           SET (autovacuum_vacuum_scale_factor = 0.05);

-- fillfactor applies to newly written pages only; videos was 17 % HOT with a 1,781-byte row.

-- NOT DONE, deliberately — §6-10 (lift channel_stats out of videos.metadata):
-- that UPDATE rewrites all 1.1 M rows of a 4,024 MB table. Postgres writes the new version before
-- freeing the old, so the heap roughly doubles for the duration: ~1.7 GB of new heap plus TOAST
-- against ~3.2 GB of free space on a 12 GB disk that the audit already has filling this month.
-- It needs the disk grown (or the table rewritten in batches with a vacuum between) first.
