-- Create a function to refresh the competitor channel summary materialized view
-- This function uses SECURITY DEFINER to run with elevated privileges
-- allowing it to refresh the materialized view even when called by regular users

CREATE OR REPLACE FUNCTION refresh_competitor_channel_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Refresh the materialized view
  REFRESH MATERIALIZED VIEW competitor_channel_summary;
  
  -- Log the refresh (optional - remove if you don't want logging)
  RAISE NOTICE 'Competitor channel summary refreshed at %', NOW();
END;
$$;

-- Grant execute permission to authenticated users (your app)
GRANT EXECUTE ON FUNCTION refresh_competitor_channel_summary() TO authenticated;

-- Grant execute permission to anonymous users (if needed for public APIs)
GRANT EXECUTE ON FUNCTION refresh_competitor_channel_summary() TO anon;

-- Add a comment to document the function
COMMENT ON FUNCTION refresh_competitor_channel_summary() IS 'Refreshes the competitor_channel_summary materialized view with proper permissions';