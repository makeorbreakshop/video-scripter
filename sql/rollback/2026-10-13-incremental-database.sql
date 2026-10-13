-- Restore backed-up worker files first while affected jobs are idle. Keep additive metadata
-- and queued keys for diagnosis/recovery; no source data or history is removed.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT c.relname,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND NOT t.tgisinternal
    AND t.tgfoid='public.capture_mirror_changes()'::regprocedure
 LOOP EXECUTE format('DROP TRIGGER %I ON public.%I',r.tgname,r.relname); END LOOP;
END $$;
DROP TRIGGER IF EXISTS track_semantic_content_change ON public.videos;
COMMIT;
-- Optional after rollback: DROP INDEX CONCURRENTLY public.videos_semantic_change_idx;
-- Retain the nullable content clock and mirror metadata until recovery is settled.
