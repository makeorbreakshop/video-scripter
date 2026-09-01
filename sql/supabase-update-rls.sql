-- Retired 2026-09-01: this former development helper disabled RLS and created
-- unconditional PUBLIC policies on user workspace tables.
DO $$
BEGIN
  RAISE EXCEPTION 'This script is retired because it creates public write access';
END
$$;
