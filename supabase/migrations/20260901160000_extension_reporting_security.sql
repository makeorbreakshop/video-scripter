-- Preserve the Chrome extension's deliberately public, read-only reporting
-- surface without relying on owner-privileged views.
BEGIN;
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '45s';

-- The extension already submits this non-sensitive display hint. Keep it
-- bounded and prevent access to processing state/result columns.
GRANT INSERT (hint) ON public.touch_queue TO anon, authenticated;
DROP POLICY "Extension can enqueue validated YouTube touches" ON public.touch_queue;
CREATE POLICY "Extension can enqueue validated YouTube touches"
  ON public.touch_queue FOR INSERT TO anon, authenticated
  WITH CHECK (
    kind IN ('video', 'channel', 'handle')
    AND mode IN ('click', 'passive')
    AND length(source_url) <= 2048
    AND (hint IS NULL OR length(hint) <= 200)
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

CREATE OR REPLACE FUNCTION public.extension_candidates_report()
RETURNS TABLE (
  channel_id text,
  channel_title text,
  subscriber_count bigint,
  video_count integer,
  seen_count integer,
  status text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
  SELECT c.channel_id, c.channel_title, c.subscriber_count, c.video_count,
         c.seen_count, c.status
  FROM public.channel_candidates c
  ORDER BY c.last_seen DESC
  LIMIT 20
$$;

CREATE OR REPLACE FUNCTION public.extension_growth_report()
RETURNS TABLE (day date, videos_added integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
  SELECT g.day, g.videos_added
  FROM public.ext_growth_cache g
  ORDER BY g.day
$$;

CREATE OR REPLACE FUNCTION public.extension_recent_report()
RETURNS TABLE (
  id bigint,
  kind text,
  ref text,
  mode text,
  done boolean,
  result text,
  display_name varchar
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
  SELECT q.id, q.kind, q.ref, q.mode, q.processed_at IS NOT NULL AS done,
         q.result,
         COALESCE(dc.channel_title, v.channel_name::varchar,
                  q.hint::varchar, q.ref::varchar) AS display_name
  FROM public.touch_queue q
  LEFT JOIN public.discovered_channels dc
    ON q.result = ('enrolled:' || dc.channel_id)
    OR q.result = ('already-enrolled:' || dc.channel_id)
  LEFT JOIN public.videos v ON q.kind = 'video' AND v.id = q.ref
  ORDER BY q.id DESC
  LIMIT 15
$$;

CREATE OR REPLACE FUNCTION public.extension_stats_report()
RETURNS TABLE (
  channels_tracked bigint,
  videos_est bigint,
  snapshots_today bigint,
  queue_pending bigint,
  processed_today bigint,
  quota_today integer,
  quota_limit integer,
  discovery_today bigint,
  discovery_cap integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
  SELECT
    (SELECT count(*) FROM public.discovered_channels)
      + (SELECT count(*) FROM public.competitor_youtube_channels),
    (SELECT c.reltuples::bigint FROM pg_catalog.pg_class c WHERE c.relname = 'videos'),
    (SELECT count(*) FROM public.view_snapshots WHERE snapshot_date = CURRENT_DATE),
    (SELECT count(*) FROM public.touch_queue WHERE processed_at IS NULL),
    (SELECT count(*) FROM public.touch_queue WHERE processed_at::date = CURRENT_DATE),
    (SELECT COALESCE(quota_used, 0) FROM public.youtube_quota_usage WHERE date = CURRENT_DATE),
    10000,
    (SELECT COALESCE(sum(units), 0::bigint) FROM public.quota_ledger
      WHERE date = CURRENT_DATE AND category = 'discovery'),
    2000
$$;

REVOKE ALL ON FUNCTION public.extension_candidates_report() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.extension_growth_report() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.extension_recent_report() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.extension_stats_report() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.extension_candidates_report() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.extension_growth_report() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.extension_recent_report() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.extension_stats_report() TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.ext_candidates WITH (security_invoker = true) AS
SELECT * FROM public.extension_candidates_report();
CREATE OR REPLACE VIEW public.ext_growth WITH (security_invoker = true) AS
SELECT * FROM public.extension_growth_report();
CREATE OR REPLACE VIEW public.ext_recent WITH (security_invoker = true) AS
SELECT * FROM public.extension_recent_report();
CREATE OR REPLACE VIEW public.ext_stats WITH (security_invoker = true) AS
SELECT * FROM public.extension_stats_report();

REVOKE ALL ON TABLE
  public.ext_candidates, public.ext_growth, public.ext_recent, public.ext_stats
FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE
  public.ext_candidates, public.ext_growth, public.ext_recent, public.ext_stats
TO anon, authenticated, service_role;

COMMIT;
