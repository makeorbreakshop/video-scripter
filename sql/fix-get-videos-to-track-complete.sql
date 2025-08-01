-- Complete fix for get_videos_to_track function
-- Drop ALL existing versions first

-- Drop all overloaded versions
DROP FUNCTION IF EXISTS get_videos_to_track(INTEGER);
DROP FUNCTION IF EXISTS get_videos_to_track(INTEGER, FLOAT, FLOAT, FLOAT);
DROP FUNCTION IF EXISTS get_videos_to_track(INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS get_videos_to_track(INTEGER, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION);
DROP FUNCTION IF EXISTS get_videos_to_track();

-- Create the ONE proper version
CREATE OR REPLACE FUNCTION get_videos_to_track(p_daily_quota_limit INTEGER DEFAULT 100000)
RETURNS TABLE (
    video_id TEXT,
    priority_tier INTEGER,
    days_since_published INTEGER
) AS $$
BEGIN
    -- Return ALL videos that need tracking today, up to the quota limit
    -- Prioritize by tier (1 highest, 6 lowest) and within each tier by last_tracked
    RETURN QUERY
    WITH videos_needing_tracking AS (
        SELECT 
            vtp.video_id,
            vtp.priority_tier,
            EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER as days_since_published,
            vtp.last_tracked,
            -- Order by tier first, then by last tracked (nulls first)
            ROW_NUMBER() OVER (
                ORDER BY 
                    vtp.priority_tier ASC,  -- Lower tier number = higher priority
                    vtp.last_tracked ASC NULLS FIRST,  -- Never tracked = highest priority within tier
                    v.published_at DESC  -- Newer videos first as tiebreaker
            ) as rn
        FROM view_tracking_priority vtp
        JOIN videos v ON v.id = vtp.video_id
        WHERE v.published_at IS NOT NULL
          AND (vtp.next_track_date IS NULL OR vtp.next_track_date <= CURRENT_DATE)
    )
    SELECT 
        video_id,
        priority_tier,
        days_since_published
    FROM videos_needing_tracking
    WHERE rn <= p_daily_quota_limit
    ORDER BY rn;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_videos_to_track(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_videos_to_track(INTEGER) TO anon;

-- Test query to verify it works
SELECT COUNT(*) as total_to_track,
       COUNT(DISTINCT priority_tier) as tiers_covered
FROM get_videos_to_track(16650);