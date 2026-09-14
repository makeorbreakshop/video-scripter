-- Rollback for sql/2026-09-14-drop-idx-videos-id-llm-summary.sql.
--
-- Exact definition as captured from pg_indexes on 2026-09-14, before the drop:
--   CREATE INDEX idx_videos_id_llm_summary ON public.videos USING btree (id, llm_summary)
--
-- CONCURRENTLY: building this takes a full pass over a 1,734 MB heap and it must not hold a
-- write lock on `videos` while it does. Cannot run inside a transaction block.
--
-- NOTE: rebuilding it after the null-out gives a 189 MB index whose second column is NULL for
-- every row. If you are rolling back because a query got slower, check first that the query is
-- not one that should be reading video_text instead — this index cannot help a query whose
-- column is empty.
create index concurrently if not exists idx_videos_id_llm_summary
  on public.videos using btree (id, llm_summary);
