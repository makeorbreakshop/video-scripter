-- Additive nullable metadata. Apply with lock_timeout=2s, statement_timeout=15s.
ALTER TABLE public.score_dirty ADD COLUMN IF NOT EXISTS waiting_on text[];
ALTER TABLE public.score_dirty ADD COLUMN IF NOT EXISTS waiting_until timestamptz;
ALTER TABLE public.obs_cache_dirty ADD COLUMN IF NOT EXISTS requested_at timestamptz;
-- Separate autocommit statements; never wrap CONCURRENTLY in a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS score_dirty_waiting_dependencies_idx
 ON public.score_dirty USING gin(waiting_on) WHERE waiting_until IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS obs_cache_dirty_requested_idx
 ON public.obs_cache_dirty(requested_at,video_id)
 WHERE requested_at IS NOT NULL AND NOT requires_bootstrap;
