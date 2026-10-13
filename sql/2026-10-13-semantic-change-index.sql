-- Run outside a transaction. No backfill; online index build permits normal ingestion.
CREATE INDEX CONCURRENTLY IF NOT EXISTS videos_semantic_change_idx ON public.videos
 (greatest(coalesce(semantic_changed_at,updated_at),published_at),id);
