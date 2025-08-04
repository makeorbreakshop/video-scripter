-- Fix permissions for topic distribution refresh
-- This allows the API to refresh the materialized view

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.refresh_topic_distribution_stats();

-- Create a new function that refreshes the materialized view
-- This function runs with the privileges of the definer (postgres)
CREATE OR REPLACE FUNCTION public.refresh_topic_distribution_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Refresh the materialized view
  REFRESH MATERIALIZED VIEW CONCURRENTLY topic_distribution_stats;
  
  -- Log the refresh
  RAISE NOTICE 'Topic distribution stats refreshed at %', NOW();
END;
$$;

-- Grant execute permission to authenticated and service_role
GRANT EXECUTE ON FUNCTION public.refresh_topic_distribution_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_topic_distribution_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_topic_distribution_stats() TO anon;

-- Also ensure the materialized view has proper permissions
GRANT SELECT ON topic_distribution_stats TO authenticated;
GRANT SELECT ON topic_distribution_stats TO service_role;
GRANT SELECT ON topic_distribution_stats TO anon;

-- Create an alternative function that doesn't use CONCURRENTLY (in case index is missing)
CREATE OR REPLACE FUNCTION public.refresh_topic_stats_simple()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Refresh without CONCURRENTLY (faster but locks the view)
  REFRESH MATERIALIZED VIEW topic_distribution_stats;
  
  RETURN;
END;
$$;

-- Grant permissions for the simple version too
GRANT EXECUTE ON FUNCTION public.refresh_topic_stats_simple() TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_topic_stats_simple() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_topic_stats_simple() TO anon;