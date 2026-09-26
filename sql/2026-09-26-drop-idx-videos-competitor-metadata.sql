-- Drop idx_videos_competitor_metadata (28 MB) before the description/metadata null-out.
--
-- It indexes (is_competitor, metadata->>'youtube_channel_id'); once metadata is cleared it indexes
-- NULLs, and its readers now go through video_text driven by idx_videos_channel_id (the key's value
-- equals channel_id wherever it exists — TABLESAMPLE 1 %, 7,475/7,475). While it exists every
-- null-out UPDATE that clears metadata is non-HOT: measured 2026-09-26 at ~15 ms/row with a new
-- entry in each of the remaining 42 indexes. Rollback: sql/rollback/2026-09-26-drop-idx-videos-competitor-metadata.sql
set lock_timeout = '5min';
set statement_timeout = '15min'; -- the session default (2 min) is shorter than the wait on old transactions
drop index concurrently if exists public.idx_videos_competitor_metadata;
