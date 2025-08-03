-- Create an efficient function to get tier counts in a single query
CREATE OR REPLACE FUNCTION get_tier_counts()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  result jsonb := '{}';
  tier_record RECORD;
BEGIN
  -- Get counts for each tier in a single query
  FOR tier_record IN 
    SELECT priority_tier, COUNT(*) as tier_count
    FROM view_tracking_priority
    WHERE priority_tier BETWEEN 1 AND 6
    GROUP BY priority_tier
    ORDER BY priority_tier
  LOOP
    result := jsonb_set(result, ARRAY[tier_record.priority_tier::text], to_jsonb(tier_record.tier_count));
  END LOOP;
  
  RETURN result;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_tier_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION get_tier_counts() TO service_role;