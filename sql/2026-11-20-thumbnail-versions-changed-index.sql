-- 2026-11-20: launch-track's candidate query (lib/nightly/sampling-candidates.ts, the `changed`
-- CTE) every 5 minutes. NOT YET APPLIED — needs Brandon's yes for a production migration.
--
-- `changed` wants thumbnail versions > 1 first seen in the last 60 days. The only usable index is
-- idx_thumbver_first_seen (first_seen), so the scan visits every row of the window — 320,673 —
-- and filters out the 276,852 first-version rows (every new video's first thumbnail):
--   Index Scan using idx_thumbver_first_seen ... Rows Removed by Filter: 276852
--   Buffers: shared hit=272146 read=346          (EXPLAIN ANALYZE, warm, 2026-11-20)
-- pg_stat_statements: 1,724 calls, 32 s mean, 60.7 M blocks read — the largest single reader of
-- the instance (29 GB database, 512 MB shared_buffers, 85.6 % hit ratio).
--
-- A partial index holds only version > 1 rows (~44 K in the window, a few MB) and carries
-- video_id, so the scan touches the matching rows only.
-- Run with: set lock_timeout = '10min'; set statement_timeout = '45min';  (CONCURRENTLY waits
-- for every older snapshot; 5 s and 120 s both failed on 2026-11-20 and left INVALID indexes.)
CREATE INDEX CONCURRENTLY IF NOT EXISTS thumbnail_versions_changed_first_seen_idx
  ON public.thumbnail_versions (first_seen) INCLUDE (video_id) WHERE version > 1;

-- Verify (expect an Index [Only] Scan on the new index, Rows Removed by Filter near 0):
--   explain (analyze, buffers) select video_id from thumbnail_versions
--    where version > 1 and first_seen > now() - interval '60 days' and video_id is not null;
-- If a build fails: select indexrelid::regclass from pg_index where not indisvalid;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS thumbnail_versions_changed_first_seen_idx;
