-- Drop the three indexes that exist only because of videos.llm_summary. AWAITING APPROVAL.
--
-- 242 MB returned immediately (idx_videos_id_llm_summary 189 MB, idx_videos_llm_summary_null 30 MB,
-- idx_videos_llm_summary_status 23 MB), and it must happen BEFORE the llm_summary null-out, not
-- after as the 2026-09-14 plan had it: while an index names llm_summary, every null-out UPDATE is
-- non-HOT and writes a new entry into all 45 indexes of `videos` (~420 K rows × 45). With these
-- gone, llm_summary is unindexed and the updates can be HOT.
--
-- Readers: none in code (lib/app/video-text-access.test.ts: llm_summary cleared). The ~4,000
-- scans/min on idx_videos_id_llm_summary are `where id = any(...)` existence probes the planner
-- happens to answer index-only from this index; videos_pkey (48 MB) answers them identically.
--
-- CONCURRENTLY cannot run in a transaction: psql on the session pooler, statement by statement.
--   psql "$DATABASE_SESSION_URL" -v ON_ERROR_STOP=1 -f sql/2026-09-26-drop-llm-summary-indexes.sql
-- Rollback: sql/rollback/2026-09-26-drop-llm-summary-indexes.sql (rebuilds, ~1-3 min, online).
set lock_timeout = '5s';
drop index concurrently if exists public.idx_videos_llm_summary_status;
drop index concurrently if exists public.idx_videos_llm_summary_null;
drop index concurrently if exists public.idx_videos_id_llm_summary;
