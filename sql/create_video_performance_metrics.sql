-- Create a table to store pre-calculated performance metrics
-- This dramatically improves performance by avoiding complex calculations on every request

-- Drop existing objects if needed (comment out if you want to preserve data)
-- DROP TABLE IF EXISTS video_performance_metrics CASCADE;

CREATE TABLE IF NOT EXISTS video_performance_metrics (
    video_id UUID PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
    channel_name TEXT NOT NULL,
    
    -- Basic info
    published_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- View metrics
    total_views BIGINT NOT NULL,
    age_days INTEGER NOT NULL,
    
    -- VPD calculations
    current_vpd NUMERIC NOT NULL, -- Last 30 days
    initial_vpd NUMERIC NOT NULL, -- First 30 days
    lifetime_vpd NUMERIC NOT NULL, -- Total views / age
    
    -- Performance scores
    channel_baseline_vpd NUMERIC NOT NULL, -- Channel avg when published
    indexed_score NUMERIC NOT NULL, -- initial_vpd / baseline
    velocity_trend NUMERIC NOT NULL, -- current_vpd / initial_vpd * 100
    trend_direction TEXT CHECK (trend_direction IN ('↗️', '→', '↘️')),
    
    -- Tier classification
    performance_tier TEXT NOT NULL
);

CREATE INDEX idx_video_performance_channel ON video_performance_metrics(channel_name);
CREATE INDEX idx_video_performance_published ON video_performance_metrics(published_at DESC);
CREATE INDEX idx_video_performance_score ON video_performance_metrics(indexed_score DESC);
CREATE INDEX idx_video_performance_vpd ON video_performance_metrics(current_vpd DESC);

-- Create a function to update performance metrics for a single video
CREATE OR REPLACE FUNCTION update_video_performance_metrics(p_video_id UUID)
RETURNS void AS $$
DECLARE
    v_channel_name TEXT;
    v_published_at TIMESTAMP WITH TIME ZONE;
    v_total_views BIGINT;
    v_age_days INTEGER;
    v_current_vpd NUMERIC;
    v_initial_vpd NUMERIC;
    v_lifetime_vpd NUMERIC;
    v_channel_baseline NUMERIC;
    v_indexed_score NUMERIC;
    v_velocity_trend NUMERIC;
BEGIN
    -- Get video info
    SELECT channel_name, published_at, view_count
    INTO v_channel_name, v_published_at, v_total_views
    FROM videos
    WHERE id = p_video_id;
    
    IF NOT FOUND THEN
        RETURN;
    END IF;
    
    -- Calculate age in days
    v_age_days := GREATEST(1, EXTRACT(EPOCH FROM (NOW() - v_published_at)) / 86400)::INTEGER;
    
    -- Calculate lifetime VPD
    v_lifetime_vpd := v_total_views::NUMERIC / v_age_days;
    
    -- Calculate current VPD from last 30 days of daily_analytics
    WITH recent_analytics AS (
        SELECT date, views
        FROM daily_analytics
        WHERE video_id = p_video_id
          AND date >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY date DESC
    )
    SELECT 
        CASE 
            WHEN COUNT(*) >= 2 THEN 
                (MAX(views) - MIN(views))::NUMERIC / GREATEST(1, EXTRACT(EPOCH FROM (MAX(date) - MIN(date))) / 86400)
            ELSE 
                v_lifetime_vpd -- Fallback to lifetime if not enough data
        END
    INTO v_current_vpd
    FROM recent_analytics;
    
    -- Calculate initial VPD from first 30 days
    WITH initial_analytics AS (
        SELECT date, views
        FROM daily_analytics
        WHERE video_id = p_video_id
          AND date <= v_published_at::DATE + INTERVAL '30 days'
        ORDER BY date DESC
        LIMIT 1
    )
    SELECT 
        CASE 
            WHEN views > 0 THEN 
                views::NUMERIC / GREATEST(1, EXTRACT(EPOCH FROM (date - v_published_at::DATE)) / 86400)
            ELSE 
                v_current_vpd -- Fallback for new videos
        END
    INTO v_initial_vpd
    FROM initial_analytics;
    
    -- Fallback if no analytics data
    v_current_vpd := COALESCE(v_current_vpd, v_lifetime_vpd);
    v_initial_vpd := COALESCE(v_initial_vpd, v_current_vpd);
    
    -- Get channel baseline (median VPD for videos published around the same time)
    WITH channel_videos AS (
        SELECT view_count, published_at
        FROM videos
        WHERE channel_name = v_channel_name
          AND published_at >= v_published_at - INTERVAL '90 days'
          AND published_at <= v_published_at + INTERVAL '90 days'
          AND view_count > 0
          AND id != p_video_id
    )
    SELECT 
        COALESCE(
            PERCENTILE_CONT(0.5) WITHIN GROUP (
                ORDER BY view_count::NUMERIC / GREATEST(1, EXTRACT(EPOCH FROM (NOW() - published_at)) / 86400)
            ),
            100 -- Default baseline
        )
    INTO v_channel_baseline
    FROM channel_videos;
    
    -- Calculate derived metrics
    v_indexed_score := v_initial_vpd / GREATEST(1, v_channel_baseline);
    v_velocity_trend := (v_current_vpd / GREATEST(1, v_initial_vpd)) * 100;
    
    -- Insert or update the metrics
    INSERT INTO video_performance_metrics (
        video_id, channel_name, published_at, total_views, age_days,
        current_vpd, initial_vpd, lifetime_vpd,
        channel_baseline_vpd, indexed_score, velocity_trend,
        trend_direction, performance_tier
    ) VALUES (
        p_video_id, v_channel_name, v_published_at, v_total_views, v_age_days,
        ROUND(v_current_vpd, 2), ROUND(v_initial_vpd, 2), ROUND(v_lifetime_vpd, 2),
        ROUND(v_channel_baseline, 2), ROUND(v_indexed_score, 2), ROUND(v_velocity_trend, 0),
        CASE 
            WHEN v_velocity_trend > 110 THEN '↗️'
            WHEN v_velocity_trend < 90 THEN '↘️'
            ELSE '→'
        END,
        CASE 
            WHEN v_indexed_score >= 3.0 THEN '🚀 Viral Hit'
            WHEN v_indexed_score >= 2.0 THEN '✨ Strong Performer'
            WHEN v_indexed_score >= 1.2 THEN '✅ Above Average'
            WHEN v_indexed_score >= 0.8 THEN '📊 Average'
            WHEN v_indexed_score >= 0.5 THEN '⚠️ Below Average'
            ELSE 'Needs Attention'
        END
    )
    ON CONFLICT (video_id) DO UPDATE SET
        channel_name = EXCLUDED.channel_name,
        published_at = EXCLUDED.published_at,
        total_views = EXCLUDED.total_views,
        age_days = EXCLUDED.age_days,
        current_vpd = EXCLUDED.current_vpd,
        initial_vpd = EXCLUDED.initial_vpd,
        lifetime_vpd = EXCLUDED.lifetime_vpd,
        channel_baseline_vpd = EXCLUDED.channel_baseline_vpd,
        indexed_score = EXCLUDED.indexed_score,
        velocity_trend = EXCLUDED.velocity_trend,
        trend_direction = EXCLUDED.trend_direction,
        performance_tier = EXCLUDED.performance_tier,
        last_calculated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Create a function to bulk update all videos for a channel
CREATE OR REPLACE FUNCTION update_channel_performance_metrics(p_channel_name TEXT)
RETURNS void AS $$
DECLARE
    v_video_id UUID;
BEGIN
    FOR v_video_id IN 
        SELECT id FROM videos 
        WHERE channel_name = p_channel_name 
        AND view_count > 0
    LOOP
        PERFORM update_video_performance_metrics(v_video_id);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Create a function to update metrics for recently active videos
CREATE OR REPLACE FUNCTION update_recent_performance_metrics()
RETURNS void AS $$
BEGIN
    -- Update videos that had view changes in the last 24 hours
    WITH recent_videos AS (
        SELECT DISTINCT video_id
        FROM daily_analytics
        WHERE date >= CURRENT_DATE - INTERVAL '1 day'
    )
    SELECT update_video_performance_metrics(video_id)
    FROM recent_videos;
END;
$$ LANGUAGE plpgsql;

-- Example: Update all Make or Break Shop videos
-- SELECT update_channel_performance_metrics('Make or Break Shop');

-- Set up a cron job to update metrics daily (requires pg_cron extension)
-- SELECT cron.schedule('update-performance-metrics', '0 3 * * *', 'SELECT update_recent_performance_metrics();');