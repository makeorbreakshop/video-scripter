-- Retired 2026-09-01: disabling RLS exposes owner-scoped workspace data.
-- Use a local fixture database for unauthenticated development instead.
DO $$
BEGIN
  RAISE EXCEPTION 'This script is retired because it disables production security controls';
END
$$;
