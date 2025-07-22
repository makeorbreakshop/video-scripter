-- Fix for missing calculate_tracking_priority function
-- Run this script to fix the "function does not exist" error

-- First, drop the old trigger that's causing issues
DROP TRIGGER IF EXISTS trigger_update_video_tracking_priority ON videos;

-- Drop the old function that uses the complex priority calculation
DROP FUNCTION IF EXISTS update_video_tracking_priority();

-- Create the simple age-based calculate_tracking_priority function
CREATE OR REPLACE FUNCTION calculate_tracking_priority(p_days_since_published INTEGER)
RETURNS INTEGER AS $$
BEGIN
    -- Simple age-based tiering
    IF p_days_since_published <= 7 THEN
        RETURN 1;  -- New videos (daily tracking)
    ELSIF p_days_since_published <= 30 THEN
        RETURN 2;  -- Recent videos (every 3 days)
    ELSIF p_days_since_published <= 90 THEN
        RETURN 3;  -- Medium-age videos (weekly)
    ELSIF p_days_since_published <= 180 THEN
        RETURN 4;  -- Older videos (bi-weekly)
    ELSIF p_days_since_published <= 365 THEN
        RETURN 5;  -- Very old videos (monthly)
    ELSE
        RETURN 6;  -- Ancient videos (monthly)
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create a new trigger function that uses the simple priority calculation
CREATE OR REPLACE FUNCTION update_view_tracking_priority_on_video_update() RETURNS TRIGGER AS $$
DECLARE
    v_days_since_published INTEGER;
    v_priority_tier INTEGER;
BEGIN
    -- Calculate days since published
    v_days_since_published := EXTRACT(DAY FROM (NOW() - NEW.published_at))::INTEGER;
    
    -- Get priority tier using the simple function
    v_priority_tier := calculate_tracking_priority(v_days_since_published);
    
    -- Insert or update the priority
    INSERT INTO view_tracking_priority (video_id, priority_tier, updated_at)
    VALUES (NEW.id, v_priority_tier, NOW())
    ON CONFLICT (video_id) DO UPDATE SET
        priority_tier = EXCLUDED.priority_tier,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
CREATE TRIGGER update_view_tracking_priority_on_video_update
AFTER INSERT OR UPDATE OF published_at ON videos
FOR EACH ROW
EXECUTE FUNCTION update_view_tracking_priority_on_video_update();

-- Also ensure the get_videos_to_track function exists with 6-tier support
CREATE OR REPLACE FUNCTION get_videos_to_track(batch_size INT DEFAULT 100000)
RETURNS TABLE (
    video_id TEXT,
    priority_tier INT
) AS $$
DECLARE
    tier1_count INT;
    tier2_count INT;
    tier3_count INT;
    tier4_count INT;
    tier5_count INT;
    tier6_count INT;
BEGIN
    -- Calculate counts for each tier (same percentages as before)
    tier1_count := FLOOR(batch_size * 0.25);  -- 25% for newest videos
    tier2_count := FLOOR(batch_size * 0.20);  -- 20% for recent videos
    tier3_count := FLOOR(batch_size * 0.20);  -- 20% for medium-age videos
    tier4_count := FLOOR(batch_size * 0.15);  -- 15% for older videos
    tier5_count := FLOOR(batch_size * 0.15);  -- 15% for very old videos
    tier6_count := FLOOR(batch_size * 0.05);  -- 5% for ancient videos
    
    RETURN QUERY
    -- Tier 1: Videos that need daily tracking (≤ 7 days old)
    (SELECT v.video_id, 1 as priority_tier
     FROM view_tracking_priority v
     WHERE v.priority_tier = 1
       AND (v.next_track_date IS NULL OR v.next_track_date <= NOW())
     ORDER BY v.last_tracked ASC NULLS FIRST, v.video_id
     LIMIT tier1_count)
    
    UNION ALL
    
    -- Tier 2: Recent videos (8-30 days old)
    (SELECT v.video_id, 2 as priority_tier
     FROM view_tracking_priority v
     WHERE v.priority_tier = 2
       AND (v.next_track_date IS NULL OR v.next_track_date <= NOW())
     ORDER BY v.last_tracked ASC NULLS FIRST, v.video_id
     LIMIT tier2_count)
    
    UNION ALL
    
    -- Tier 3: Medium-age videos (31-90 days old)
    (SELECT v.video_id, 3 as priority_tier
     FROM view_tracking_priority v
     WHERE v.priority_tier = 3
       AND (v.next_track_date IS NULL OR v.next_track_date <= NOW())
     ORDER BY v.last_tracked ASC NULLS FIRST, v.video_id
     LIMIT tier3_count)
    
    UNION ALL
    
    -- Tier 4: Older videos (91-180 days old)
    (SELECT v.video_id, 4 as priority_tier
     FROM view_tracking_priority v
     WHERE v.priority_tier = 4
       AND (v.next_track_date IS NULL OR v.next_track_date <= NOW())
     ORDER BY v.last_tracked ASC NULLS FIRST, v.video_id
     LIMIT tier4_count)
    
    UNION ALL
    
    -- Tier 5: Very old videos (181-365 days old)
    (SELECT v.video_id, 5 as priority_tier
     FROM view_tracking_priority v
     WHERE v.priority_tier = 5
       AND (v.next_track_date IS NULL OR v.next_track_date <= NOW())
     ORDER BY v.last_tracked ASC NULLS FIRST, v.video_id
     LIMIT tier5_count)
    
    UNION ALL
    
    -- Tier 6: Ancient videos (> 365 days old)
    (SELECT v.video_id, 6 as priority_tier
     FROM view_tracking_priority v
     WHERE v.priority_tier = 6
       AND (v.next_track_date IS NULL OR v.next_track_date <= NOW())
     ORDER BY v.last_tracked ASC NULLS FIRST, v.video_id
     LIMIT tier6_count);
END;
$$ LANGUAGE plpgsql;

-- Create a new trigger function that uses the simple priority calculation
CREATE OR REPLACE FUNCTION update_view_tracking_priority_on_video_update() RETURNS TRIGGER AS $$
DECLARE
    v_days_since_published INTEGER;
    v_priority_tier INTEGER;
BEGIN
    -- Calculate days since published
    v_days_since_published := EXTRACT(DAY FROM (NOW() - NEW.published_at))::INTEGER;
    
    -- Get priority tier using the simple function
    v_priority_tier := calculate_tracking_priority(v_days_since_published);
    
    -- Insert or update the priority
    INSERT INTO view_tracking_priority (video_id, priority_tier, updated_at)
    VALUES (NEW.id, v_priority_tier, NOW())
    ON CONFLICT (video_id) DO UPDATE SET
        priority_tier = EXCLUDED.priority_tier,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
CREATE TRIGGER update_view_tracking_priority_on_video_update
AFTER INSERT OR UPDATE OF published_at ON videos
FOR EACH ROW
EXECUTE FUNCTION update_view_tracking_priority_on_video_update();