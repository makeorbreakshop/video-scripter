DO $test$
DECLARE
  failures text[] := ARRAY[]::text[];
  object_name text;
  target_tables constant text[] := ARRAY[
    'account', 'analyses', 'baseline_analytics', 'baseline_recompute_progress',
    'bertopic_clusters', 'channel_candidates', 'channel_discovery',
    'channel_performance_ratios', 'channels', 'chunks',
    'comments', 'daily_analytics', 'discovery_edges', 'discovery_method_metrics',
    'discovery_metrics', 'discovery_search_queries', 'documents',
    'ext_growth_cache', 'format_detection_feedback', 'google_pse_quota',
    'idea_heist_discoveries', 'old_patterns', 'patterns',
    'performance_envelopes', 'projects', 'quota_ledger', 'script_data',
    'session', 'skyscraper_analyses', 'thumbnail_battle_games',
    'thumbnail_battle_matchups', 'topic_categories', 'topic_hierarchy_mapping',
    'touch_queue', 'verification', 'video_patterns', 'video_performance_metrics',
    'thumbnail_versions', 'video_processing_jobs', 'videos', 'view_snapshots',
    'view_tracking_priority',
    'youtube_comments', 'youtube_quota_calls', 'youtube_quota_usage'
  ];
  owner_tables constant text[] := ARRAY['chunks', 'documents', 'projects', 'script_data', 'videos'];
  public_read_tables constant text[] := ARRAY['channels', 'videos', 'view_snapshots', 'view_tracking_priority'];
  legacy_locked_tables constant text[] := ARRAY[
    'channel_import_status', 'channel_relationships', 'profiles',
    'thumbnail_battle_players', 'worker_control'
  ];
  target_views constant text[] := ARRAY[
    'discovery_performance', 'format_distribution', 'llm_summary_status',
    'pending_channel_discoveries', 'quota_calls_summary', 'quota_daily_summary',
    'topic_distribution', 'topic_domain_summary', 'unprocessed_thumbnails',
    'video_classification_stats', 'videos_2024_unprocessed'
  ];
BEGIN
  FOR object_name IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relrowsecurity
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass
          AND d.objid = c.oid
          AND d.deptype = 'e'
      )
  LOOP
    failures := array_append(failures, object_name || ': public application table omitted from RLS inventory');
  END LOOP;

  FOR object_name IN SELECT unnest(target_tables) LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = object_name) THEN
      failures := array_append(failures, object_name || ': RLS disabled');
    END IF;
    IF has_table_privilege('anon', format('public.%I', object_name), 'UPDATE,DELETE') THEN
      failures := array_append(failures, object_name || ': anonymous mutation remains');
    END IF;
    IF NOT (object_name = ANY(public_read_tables))
       AND has_table_privilege('anon', format('public.%I', object_name), 'SELECT') THEN
      failures := array_append(failures, object_name || ': anonymous read remains');
    END IF;
    IF object_name <> 'touch_queue' AND has_table_privilege('anon', format('public.%I', object_name), 'INSERT') THEN
      failures := array_append(failures, object_name || ': anonymous insert remains');
    END IF;
    IF NOT has_table_privilege('service_role', format('public.%I', object_name), 'SELECT,INSERT,UPDATE,DELETE') THEN
      failures := array_append(failures, object_name || ': service-role compatibility lost');
    END IF;
  END LOOP;

  FOR object_name IN SELECT unnest(owner_tables) LOOP
    IF NOT has_table_privilege('authenticated', format('public.%I', object_name), 'SELECT,INSERT,UPDATE,DELETE') THEN
      failures := array_append(failures, object_name || ': authenticated owner grants missing');
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = object_name
               AND cmd <> 'SELECT'
               AND (coalesce(qual, '') = 'true' OR coalesce(with_check, '') = 'true')) THEN
      failures := array_append(failures, object_name || ': unconditional policy remains');
    END IF;
  END LOOP;

  FOR object_name IN SELECT unnest(public_read_tables) LOOP
    IF NOT has_table_privilege('anon', format('public.%I', object_name), 'SELECT') THEN
      failures := array_append(failures, object_name || ': required public read missing');
    END IF;
  END LOOP;

  FOR object_name IN SELECT unnest(legacy_locked_tables) LOOP
    IF has_table_privilege('anon', format('public.%I', object_name), 'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('authenticated', format('public.%I', object_name), 'SELECT,INSERT,UPDATE,DELETE') THEN
      failures := array_append(failures, object_name || ': unconditional legacy client access remains');
    END IF;
    IF NOT has_table_privilege('service_role', format('public.%I', object_name), 'SELECT,INSERT,UPDATE,DELETE') THEN
      failures := array_append(failures, object_name || ': service-role compatibility lost');
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.touch_queue', 'INSERT')
     OR NOT has_column_privilege('anon', 'public.touch_queue', 'kind', 'INSERT')
     OR NOT has_column_privilege('anon', 'public.touch_queue', 'ref', 'INSERT')
     OR NOT has_column_privilege('anon', 'public.touch_queue', 'source_url', 'INSERT')
     OR NOT has_column_privilege('anon', 'public.touch_queue', 'mode', 'INSERT')
     OR has_column_privilege('anon', 'public.touch_queue', 'processed_at', 'INSERT')
     OR has_column_privilege('anon', 'public.touch_queue', 'result', 'INSERT') THEN
    failures := array_append(failures, 'touch_queue: column-level insert contract');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'touch_queue'
      AND policyname = 'Extension can enqueue validated YouTube touches'
      AND with_check LIKE '%source_url%'
      AND with_check LIKE '%passive%'
      AND with_check LIKE '%channel%'
  ) THEN
    failures := array_append(failures, 'touch_queue: validated ingress policy missing');
  END IF;

  FOR object_name IN SELECT unnest(target_views) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
      LATERAL unnest(coalesce(c.reloptions, ARRAY[]::text[])) option
      WHERE n.nspname = 'public' AND c.relname = object_name
        AND option IN ('security_invoker=on', 'security_invoker=true')
    ) THEN
      failures := array_append(failures, object_name || ': security_invoker missing');
    END IF;
    IF has_table_privilege('anon', format('public.%I', object_name), 'SELECT') THEN
      failures := array_append(failures, object_name || ': anonymous view access remains');
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'm'
      AND has_table_privilege('anon', c.oid, 'SELECT')
  ) THEN
    failures := array_append(failures, 'materialized views remain in anonymous API');
  END IF;
  IF has_function_privilege('anon', 'public.refresh_dashboard_data()', 'EXECUTE') THEN
    failures := array_append(failures, 'security-definer function remains executable by anon');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
    LATERAL unnest(coalesce(p.proconfig, ARRAY[]::text[])) config
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
      AND config = 'search_path=pg_catalog, public, extensions'
  ) THEN
    failures := array_append(failures, 'function search_path remains mutable');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION E'Security contract failed (%):\n - %', cardinality(failures), array_to_string(failures, E'\n - ');
  END IF;
END
$test$;

SELECT 'Video Scripter Supabase security contract passed' AS result;
