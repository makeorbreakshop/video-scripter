-- Update to Simple Age-Based Tier System
-- This provides better distribution across tiers

-- Drop the existing function
DROP FUNCTION IF EXISTS calculate_tracking_priority CASCADE;

-- Create new age-based priority calculation
CREATE OR REPLACE FUNCTION calculate_tracking_priority(
    p_days_since_published INTEGER
) RETURNS INTEGER AS $$
BEGIN
    -- Simple age-based tiers with better distribution
    IF p_days_since_published <= 7 THEN
        RETURN 1;  -- Tier 1: First week (highest priority)
    ELSIF p_days_since_published <= 30 THEN
        RETURN 2;  -- Tier 2: First month
    ELSIF p_days_since_published <= 90 THEN
        RETURN 3;  -- Tier 3: First 3 months
    ELSIF p_days_since_published <= 180 THEN
        RETURN 4;  -- Tier 4: First 6 months
    ELSIF p_days_since_published <= 365 THEN
        RETURN 5;  -- Tier 5: First year
    ELSE
        RETURN 6;  -- Tier 6: Older than 1 year
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Update the get_videos_to_track function to handle 6 tiers
CREATE OR REPLACE FUNCTION get_videos_to_track(
    p_daily_quota_limit INTEGER DEFAULT 100000,
    p_tier_1_percentage NUMERIC DEFAULT 0.25,  -- 25% for newest videos
    p_tier_2_percentage NUMERIC DEFAULT 0.20,  -- 20% for month-old
    p_tier_3_percentage NUMERIC DEFAULT 0.20,  -- 20% for 3-month old
    p_tier_4_percentage NUMERIC DEFAULT 0.15,  -- 15% for 6-month old
    p_tier_5_percentage NUMERIC DEFAULT 0.15,  -- 15% for 1-year old
    p_tier_6_percentage NUMERIC DEFAULT 0.05   -- 5% for oldest
)
RETURNS TABLE (
    video_id TEXT,
    priority_tier INTEGER,
    days_since_published INTEGER
) AS $$
DECLARE
    v_tier_1_limit INTEGER;
    v_tier_2_limit INTEGER;
    v_tier_3_limit INTEGER;
    v_tier_4_limit INTEGER;
    v_tier_5_limit INTEGER;
    v_tier_6_limit INTEGER;
BEGIN
    -- Calculate limits for each tier
    v_tier_1_limit := FLOOR(p_daily_quota_limit * p_tier_1_percentage);
    v_tier_2_limit := FLOOR(p_daily_quota_limit * p_tier_2_percentage);
    v_tier_3_limit := FLOOR(p_daily_quota_limit * p_tier_3_percentage);
    v_tier_4_limit := FLOOR(p_daily_quota_limit * p_tier_4_percentage);
    v_tier_5_limit := FLOOR(p_daily_quota_limit * p_tier_5_percentage);
    v_tier_6_limit := FLOOR(p_daily_quota_limit * p_tier_6_percentage);

    RETURN QUERY
    -- Tier 1: Videos less than 7 days old (daily tracking)
    (SELECT vtp.video_id, vtp.priority_tier, 
            EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER as days_since_published
     FROM view_tracking_priority vtp
     JOIN videos v ON v.id = vtp.video_id
     WHERE vtp.priority_tier = 1
       AND (vtp.next_track_date IS NULL OR vtp.next_track_date <= CURRENT_DATE)
     ORDER BY v.published_at DESC
     LIMIT v_tier_1_limit)
    
    UNION ALL
    
    -- Tier 2: Videos 7-30 days old (every 2 days)
    (SELECT vtp.video_id, vtp.priority_tier,
            EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER as days_since_published
     FROM view_tracking_priority vtp
     JOIN videos v ON v.id = vtp.video_id
     WHERE vtp.priority_tier = 2
       AND (vtp.next_track_date IS NULL OR vtp.next_track_date <= CURRENT_DATE)
     ORDER BY v.view_count DESC
     LIMIT v_tier_2_limit)
    
    UNION ALL
    
    -- Tier 3: Videos 30-90 days old (every 3 days)
    (SELECT vtp.video_id, vtp.priority_tier,
            EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER as days_since_published
     FROM view_tracking_priority vtp
     JOIN videos v ON v.id = vtp.video_id
     WHERE vtp.priority_tier = 3
       AND (vtp.next_track_date IS NULL OR vtp.next_track_date <= CURRENT_DATE)
     ORDER BY v.view_count DESC
     LIMIT v_tier_3_limit)
    
    UNION ALL
    
    -- Tier 4: Videos 90-180 days old (weekly)
    (SELECT vtp.video_id, vtp.priority_tier,
            EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER as days_since_published
     FROM view_tracking_priority vtp
     JOIN videos v ON v.id = vtp.video_id
     WHERE vtp.priority_tier = 4
       AND (vtp.next_track_date IS NULL OR vtp.next_track_date <= CURRENT_DATE)
     ORDER BY v.view_count DESC
     LIMIT v_tier_4_limit)
    
    UNION ALL
    
    -- Tier 5: Videos 180-365 days old (every 2 weeks)
    (SELECT vtp.video_id, vtp.priority_tier,
            EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER as days_since_published
     FROM view_tracking_priority vtp
     JOIN videos v ON v.id = vtp.video_id
     WHERE vtp.priority_tier = 5
       AND (vtp.next_track_date IS NULL OR vtp.next_track_date <= CURRENT_DATE)
     ORDER BY v.view_count DESC
     LIMIT v_tier_5_limit)
    
    UNION ALL
    
    -- Tier 6: Videos older than 365 days (monthly)
    (SELECT vtp.video_id, vtp.priority_tier,
            EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER as days_since_published
     FROM view_tracking_priority vtp
     JOIN videos v ON v.id = vtp.video_id
     WHERE vtp.priority_tier = 6
       AND (vtp.next_track_date IS NULL OR vtp.next_track_date <= CURRENT_DATE)
     ORDER BY RANDOM()  -- Random sampling for oldest videos
     LIMIT v_tier_6_limit);
END;
$$ LANGUAGE plpgsql;

-- Update calculateNextTrackDate in the ViewTrackingService to handle 6 tiers
-- Tier 1: Daily
-- Tier 2: Every 2 days
-- Tier 3: Every 3 days  
-- Tier 4: Weekly
-- Tier 5: Every 2 weeks
-- Tier 6: Monthly

-- Now update all existing priorities
SELECT update_all_tracking_priorities();

-- Check the new distribution
SELECT 
    priority_tier,
    COUNT(*) as video_count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM view_tracking_priority
GROUP BY priority_tier
ORDER BY priority_tier;