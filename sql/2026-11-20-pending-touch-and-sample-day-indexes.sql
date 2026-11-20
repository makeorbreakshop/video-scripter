-- 2026-11-20: two index gaps behind a large share of the database's read IO.
-- NOT YET APPLIED. Run one statement at a time (CONCURRENTLY cannot run in a transaction):
--   set lock_timeout = '5s'; then each CREATE below.
--
-- 1. touch_queue keeps every processed row forever (it is the (kind, ref) dedupe memory), so
--    1,584,095 rows hold 12 pending ones. scripts/drain-touch-queue.ts asks for the pending ones
--    every 5 minutes with two queries, and both seq-scan the 234 MB heap:
--      EXPLAIN (ANALYZE, BUFFERS) ... where processed_at is null order by id limit 1000
--        Parallel Seq Scan on touch_queue, Rows Removed by Filter: 792,047 (x2 workers),
--        Buffers: read=29,877, 157 ms
--    pg_stat_statements since 2026-11-12: 59.8 M + 55.8 M blocks read by these two statements.
--    Partial indexes hold only pending rows: a few kB.
CREATE INDEX CONCURRENTLY IF NOT EXISTS touch_queue_pending_id_idx
  ON public.touch_queue (id) WHERE processed_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS touch_queue_pending_kind_seen_idx
  ON public.touch_queue (kind, seen_at DESC, id DESC) WHERE processed_at IS NULL;

-- 2. view_samples has only its (video_id, sampled_at) primary key, so every one-day count
--    (lib/readings/sql.ts countDaySql, the pipeline health check) seq-scans 884 MB:
--    724 calls since 2026-11-12, 31 s each, 74.8 M blocks read — the single largest reader.
--    sampled_at correlates 0.86 with heap order (append-mostly), so a BRIN index answers a
--    day range in a few hundred pages at a size of tens of kB, not the ~250 MB a btree would add
--    to a disk that is at 76 %.
CREATE INDEX CONCURRENTLY IF NOT EXISTS view_samples_sampled_at_brin
  ON public.view_samples USING brin (sampled_at) WITH (pages_per_range = 32);

-- Verify (expect Index Scan / Bitmap Index Scan, buffers in the tens):
--   explain (analyze, buffers) select id from touch_queue where processed_at is null order by id limit 1000;
--   explain (analyze, buffers) select count(*) from view_samples
--     where sampled_at >= current_date - 1 and sampled_at < current_date;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS <name>;
