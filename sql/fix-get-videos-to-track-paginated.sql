-- Create a paginated version of get_videos_to_track to handle Supabase's 1000 row limit
-- This follows Supabase best practices for handling large result sets

CREATE OR REPLACE FUNCTION get_videos_to_track_batch(
    p_offset INTEGER DEFAULT 0,
    p_limit INTEGER DEFAULT 1000
)
RETURNS TABLE (
    video_id TEXT,
    priority_tier INTEGER,
    days_since_published INTEGER,
    total_count BIGINT
) AS $$
BEGIN
    -- Return videos that need tracking with pagination support
    RETURN QUERY
    WITH videos_needing_tracking AS (
        SELECT 
            vtp.video_id as vtp_video_id,
            vtp.priority_tier,
            EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER as days_since_published,
            vtp.last_tracked,
            -- Count total rows for pagination info
            COUNT(*) OVER() as total_count,
            -- Order by tier first, then by last tracked (nulls first)
            ROW_NUMBER() OVER (
                ORDER BY 
                    vtp.priority_tier ASC,  -- Lower tier number = higher priority
                    vtp.last_tracked ASC NULLS FIRST,  -- Never tracked = highest priority
                    v.published_at DESC  -- Newer videos first as tiebreaker
            ) as rn
        FROM view_tracking_priority vtp
        JOIN videos v ON v.id = vtp.video_id
        WHERE v.published_at IS NOT NULL
          AND (vtp.next_track_date IS NULL OR vtp.next_track_date <= CURRENT_DATE)
    )
    SELECT 
        vnt.vtp_video_id as video_id,
        vnt.priority_tier,
        vnt.days_since_published,
        vnt.total_count
    FROM videos_needing_tracking vnt
    WHERE vnt.rn > p_offset 
      AND vnt.rn <= p_offset + p_limit
    ORDER BY vnt.rn;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_videos_to_track_batch(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_videos_to_track_batch(INTEGER, INTEGER) TO anon;

-- Example usage:
-- First batch: SELECT * FROM get_videos_to_track_batch(0, 1000);
-- Second batch: SELECT * FROM get_videos_to_track_batch(1000, 1000);
-- Third batch: SELECT * FROM get_videos_to_track_batch(2000, 1000);