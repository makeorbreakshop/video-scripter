-- Producer grants for touch_queue, reconciled after two live incidents on
-- 2026-09-01:
--   1. The hardening migration (20260901120000) kept the INSERT policy but
--      revoked the table GRANTs, so every extension/WebSub REST insert failed
--      42501 (policy without grant = dead path).
--   2. The live hotfix granted FULL SELECT, which reopened anon reads of
--      processing state (processed_at/result) that the hardening was built
--      to block. scripts/smoke-producers.ts check 'anon read still blocked'
--      caught it.
-- Final posture: producers can INSERT and see ONLY the dedupe arbiter
-- columns; processing state stays unreadable. Run scripts/smoke-producers.ts
-- after applying (and before merging any future change to these policies).
BEGIN;

REVOKE SELECT ON public.touch_queue FROM anon, authenticated;
GRANT SELECT (kind, ref) ON public.touch_queue TO anon, authenticated;
GRANT INSERT ON public.touch_queue TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.touch_queue_id_seq TO anon, authenticated;

COMMIT;
