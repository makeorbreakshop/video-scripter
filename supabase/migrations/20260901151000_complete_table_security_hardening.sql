-- Close the final RLS inventory gap found by the production verification pass.
-- These worker/cache tables are accessed through direct PostgreSQL connections,
-- so browser roles do not need any Data API privileges.
BEGIN;
-- thumbnail_versions has a continuous watcher. Queue behind its current read
-- without terminating the worker, then complete the metadata-only ALTER.
SET LOCAL lock_timeout = '120s';
SET LOCAL statement_timeout = '150s';

DO $hardening$
DECLARE
  object_name text;
  target_tables constant text[] := ARRAY[
    'baseline_recompute_progress',
    'channel_candidates',
    'ext_growth_cache',
    'quota_ledger',
    'thumbnail_versions'
  ];
BEGIN
  FOREACH object_name IN ARRAY target_tables LOOP
    IF to_regclass(format('public.%I', object_name)) IS NULL THEN
      RAISE EXCEPTION 'Expected table public.% is missing; refusing partial hardening', object_name;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', object_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', object_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', object_name);
  END LOOP;
END
$hardening$;

COMMIT;
