-- Retired 2026-09-01: vector searches must execute through a server role or
-- an owner-scoped authenticated policy; disabling RLS is never an acceptable fallback.
DO $$
BEGIN
  RAISE EXCEPTION 'This script is retired because it disables production security controls';
END
$$;
