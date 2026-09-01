-- Metadata-only least-privilege hardening for the 2026-08-31 Supabase alert.
-- All corpus/background work observed in production runs as service_role. The
-- only anonymous write retained is a validated Chrome-extension touch enqueue.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $hardening$
DECLARE
  object_name text;
  policy_name text;
  target_tables constant text[] := ARRAY[
    'account', 'analyses', 'baseline_analytics', 'bertopic_clusters',
    'channel_discovery', 'channel_performance_ratios', 'channels', 'chunks',
    'comments', 'daily_analytics', 'discovery_edges', 'discovery_method_metrics',
    'discovery_metrics', 'discovery_search_queries', 'documents',
    'format_detection_feedback', 'google_pse_quota', 'idea_heist_discoveries',
    'old_patterns', 'patterns', 'performance_envelopes', 'projects', 'script_data',
    'session', 'skyscraper_analyses', 'thumbnail_battle_games',
    'thumbnail_battle_matchups', 'topic_categories', 'topic_hierarchy_mapping',
    'touch_queue', 'verification', 'video_patterns', 'video_performance_metrics',
    'video_processing_jobs', 'videos', 'view_snapshots', 'view_tracking_priority',
    'youtube_comments', 'youtube_quota_calls', 'youtube_quota_usage'
  ];
BEGIN
  FOREACH object_name IN ARRAY target_tables LOOP
    IF to_regclass(format('public.%I', object_name)) IS NULL THEN
      RAISE EXCEPTION 'Expected table public.% is missing; refusing partial hardening', object_name;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', object_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', object_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', object_name);

    FOR policy_name IN
      SELECT p.policyname FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = object_name
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_name, object_name);
    END LOOP;
  END LOOP;
END
$hardening$;

-- Existing RLS policies on these tables were still unconditional client
-- policies. Better Auth accesses profiles through the direct PostgreSQL
-- adapter, and all game/worker/channel endpoints run server-side, so none of
-- these tables needs a browser-facing Data API grant.
DO $legacy_policies$
DECLARE
  object_name text;
  policy_name text;
  locked_tables constant text[] := ARRAY[
    'channel_import_status', 'channel_relationships', 'profiles',
    'thumbnail_battle_players', 'worker_control'
  ];
BEGIN
  FOREACH object_name IN ARRAY locked_tables LOOP
    IF to_regclass(format('public.%I', object_name)) IS NULL THEN
      RAISE EXCEPTION 'Expected legacy table public.% is missing; refusing partial hardening', object_name;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', object_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', object_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', object_name);
    FOR policy_name IN
      SELECT p.policyname FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = object_name
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_name, object_name);
    END LOOP;
  END LOOP;
END
$legacy_policies$;

-- These are Supabase-auth-owned tables. Anonymous access is removed; a valid
-- Supabase JWT can only operate on rows whose user_id matches auth.uid().
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.chunks, public.documents, public.projects, public.script_data, public.videos
TO authenticated;

CREATE POLICY "Users can manage their own chunks"
  ON public.chunks FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own documents"
  ON public.documents FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own projects"
  ON public.projects FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own script data"
  ON public.script_data FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own videos"
  ON public.videos FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- YouTube corpus facts power public discovery UI and were observed as
-- anonymous reads in production. They remain read-only to browser roles.
GRANT SELECT ON TABLE
  public.channels, public.videos, public.view_snapshots, public.view_tracking_priority
TO anon, authenticated;
CREATE POLICY "Public can read YouTube channels"
  ON public.channels FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public can read YouTube videos"
  ON public.videos FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public can read view snapshots"
  ON public.view_snapshots FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public can read tracking cadence"
  ON public.view_tracking_priority FOR SELECT TO anon, authenticated USING (true);

-- The extension can submit only the four input columns. Processing state,
-- results, timestamps, identity, and hints remain service-role-only.
GRANT INSERT (kind, ref, source_url, mode) ON public.touch_queue TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.touch_queue_id_seq TO anon, authenticated;
CREATE POLICY "Extension can enqueue validated YouTube touches"
  ON public.touch_queue FOR INSERT TO anon, authenticated
  WITH CHECK (
    kind IN ('video', 'channel', 'handle')
    AND mode IN ('click', 'passive')
    AND length(source_url) <= 2048
    AND (
      source_url ~ '^https://([A-Za-z0-9-]+\.)?youtube\.com/'
      OR source_url ~ '^https://youtu\.be/'
    )
    AND (
      (kind = 'video' AND ref ~ '^[A-Za-z0-9_-]{11}$')
      OR (kind = 'channel' AND ref ~ '^UC[A-Za-z0-9_-]{22}$')
      OR (kind = 'handle' AND ref ~ '^@[A-Za-z0-9._-]{3,60}$')
    )
  );

DO $views$
DECLARE
  object_name text;
BEGIN
  FOREACH object_name IN ARRAY ARRAY[
    'discovery_performance', 'format_distribution', 'llm_summary_status',
    'pending_channel_discoveries', 'quota_calls_summary', 'quota_daily_summary',
    'topic_distribution', 'topic_domain_summary', 'unprocessed_thumbnails',
    'video_classification_stats', 'videos_2024_unprocessed'
  ] LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', object_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', object_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', object_name);
  END LOOP;

  FOREACH object_name IN ARRAY ARRAY[
    'analytics_stats', 'channel_age_adjusted_performance', 'channel_network_centrality',
    'competitor_channel_summary', 'competitor_youtube_channels', 'database_channel_health',
    'database_data_quality', 'database_growth_stats', 'database_performance_stats',
    'heistable_videos', 'mv_makeorbreak_dashboard', 'packaging_performance',
    'thumbnail_battle_matchup_pool', 'topic_distribution_stats',
    'video_performance_trends'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', object_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', object_name);
  END LOOP;
END
$views$;

-- pgvector is relocatable. Keeping extension objects outside public removes
-- them from the Data API surface while existing vector columns remain valid.
DO $extension$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'vector' AND n.nspname = 'public' AND e.extrelocatable
  ) THEN
    CREATE SCHEMA IF NOT EXISTS extensions;
    ALTER EXTENSION vector SET SCHEMA extensions;
  END IF;
END
$extension$;

DO $functions$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid, p.oid::regprocedure AS signature, p.prosecdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path TO pg_catalog, public, extensions', fn.signature);
    IF fn.prosecdef THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
    END IF;
  END LOOP;
END
$functions$;

GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO service_role;
COMMIT;
