-- Fix: the 20260901160000 hardening only allowed modes ('click','passive') and
-- youtube-shaped source_url, silently rejecting the two highest-volume capture
-- paths that already existed: mode='feed' (extension feed logger, source_url
-- 'feed:<path>') and mode='websub' (Render push receiver, source_url
-- 'websub:<channelId>'). Keep all shape validation; admit the real modes.
BEGIN;
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '45s';

DROP POLICY "Extension can enqueue validated YouTube touches" ON public.touch_queue;
CREATE POLICY "Extension can enqueue validated YouTube touches"
  ON public.touch_queue FOR INSERT TO anon, authenticated
  WITH CHECK (
    kind IN ('video', 'channel', 'handle')
    AND mode IN ('click', 'passive', 'feed', 'websub')
    AND (hint IS NULL OR length(hint) <= 200)
    AND (
      source_url IS NULL
      OR (
        length(source_url) <= 2048
        AND (
          source_url ~ '^https://([A-Za-z0-9-]+\.)?youtube\.com/'
          OR source_url ~ '^https://youtu\.be/'
          OR source_url ~ '^feed:/[A-Za-z0-9/_@.-]{0,200}$'
          OR source_url ~ '^websub:UC[A-Za-z0-9_-]{22}$'
        )
      )
    )
    AND (
      (kind = 'video' AND ref ~ '^[A-Za-z0-9_-]{11}$')
      OR (kind = 'channel' AND ref ~ '^UC[A-Za-z0-9_-]{22}$')
      OR (kind = 'handle' AND ref ~ '^@[A-Za-z0-9._-]{3,60}$')
    )
  );
COMMIT;

-- ON CONFLICT (kind,ref) DO NOTHING needs SELECT on the arbiter columns;
-- the hardening revoked table SELECT entirely, which also broke deduped
-- inserts (42501). Processing state/result columns stay unreadable.
GRANT SELECT (kind, ref) ON public.touch_queue TO anon, authenticated;

-- ON CONFLICT dedupe requires row visibility under RLS. Column-level SELECT
-- grants (kind, ref only) keep processing state/result unreadable; the policy
-- just makes rows visible for the arbiter check.
CREATE POLICY "Extension can see queue keys for dedupe"
  ON public.touch_queue FOR SELECT TO anon, authenticated USING (true);
