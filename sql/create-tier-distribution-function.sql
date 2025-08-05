-- Create an efficient function to get tier distribution
CREATE OR REPLACE FUNCTION get_tier_distribution()
RETURNS TABLE (
    priority_tier INTEGER,
    count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        vtp.priority_tier,
        COUNT(*)::BIGINT as count
    FROM view_tracking_priority vtp
    WHERE vtp.priority_tier BETWEEN 1 AND 6
    GROUP BY vtp.priority_tier
    ORDER BY vtp.priority_tier;
END;
$$ LANGUAGE plpgsql STABLE;