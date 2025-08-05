-- Fix the tracking_frequency_days values to match the priority tiers
UPDATE view_tracking_priority
SET tracking_frequency_days = CASE priority_tier
    WHEN 1 THEN 1   -- Daily
    WHEN 2 THEN 2   -- Every 2 days
    WHEN 3 THEN 3   -- Every 3 days
    WHEN 4 THEN 7   -- Weekly
    WHEN 5 THEN 14  -- Biweekly
    WHEN 6 THEN 30  -- Monthly
    ELSE 30         -- Default monthly
END;

-- Update the update_all_tracking_priorities function to properly set tracking_frequency_days
CREATE OR REPLACE FUNCTION update_all_tracking_priorities()
RETURNS void AS $$
BEGIN
    INSERT INTO view_tracking_priority (video_id, priority_tier, tracking_frequency_days, updated_at)
    SELECT
        v.id,
        calculate_tracking_priority(
            EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER
        ),
        CASE calculate_tracking_priority(EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER)
            WHEN 1 THEN 1   -- Daily
            WHEN 2 THEN 2   -- Every 2 days
            WHEN 3 THEN 3   -- Every 3 days
            WHEN 4 THEN 7   -- Weekly
            WHEN 5 THEN 14  -- Biweekly
            WHEN 6 THEN 30  -- Monthly
            ELSE 30         -- Default monthly
        END,
        NOW()
    FROM videos v
    WHERE v.published_at IS NOT NULL
    ON CONFLICT (video_id) DO UPDATE SET
        priority_tier = EXCLUDED.priority_tier,
        tracking_frequency_days = EXCLUDED.tracking_frequency_days,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Update the trigger function to also set tracking_frequency_days
CREATE OR REPLACE FUNCTION update_view_tracking_priority_on_video_update()
RETURNS TRIGGER AS $$
DECLARE
    v_days_since_published INTEGER;
    v_priority_tier INTEGER;
    v_tracking_frequency_days INTEGER;
BEGIN
    -- Calculate days since published
    v_days_since_published := EXTRACT(DAY FROM (NOW() - NEW.published_at))::INTEGER;

    -- Get priority tier using the simple function
    v_priority_tier := calculate_tracking_priority(v_days_since_published);
    
    -- Set tracking frequency based on tier
    v_tracking_frequency_days := CASE v_priority_tier
        WHEN 1 THEN 1   -- Daily
        WHEN 2 THEN 2   -- Every 2 days
        WHEN 3 THEN 3   -- Every 3 days
        WHEN 4 THEN 7   -- Weekly
        WHEN 5 THEN 14  -- Biweekly
        WHEN 6 THEN 30  -- Monthly
        ELSE 30         -- Default monthly
    END;

    -- Insert or update the priority
    INSERT INTO view_tracking_priority (video_id, priority_tier, tracking_frequency_days, updated_at)
    VALUES (NEW.id, v_priority_tier, v_tracking_frequency_days, NOW())
    ON CONFLICT (video_id) DO UPDATE SET
        priority_tier = EXCLUDED.priority_tier,
        tracking_frequency_days = EXCLUDED.tracking_frequency_days,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Reset next_track_date based on correct tracking frequencies
UPDATE view_tracking_priority
SET next_track_date = CASE 
    WHEN last_tracked IS NULL THEN CURRENT_DATE
    ELSE last_tracked + INTERVAL '1 day' * (
        CASE priority_tier
            WHEN 1 THEN 1   -- Daily
            WHEN 2 THEN 2   -- Every 2 days
            WHEN 3 THEN 3   -- Every 3 days
            WHEN 4 THEN 7   -- Weekly
            WHEN 5 THEN 14  -- Biweekly
            WHEN 6 THEN 30  -- Monthly
            ELSE 30         -- Default monthly
        END
    )
END;