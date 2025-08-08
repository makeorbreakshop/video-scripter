-- Complete Performance Envelope Update System
-- This creates all necessary functions for updating channel ratios and video scores

-- ============================================
-- STEP 1: Channel Performance Ratio Calculation
-- ============================================

-- Create table to store channel performance ratios (if doesn't exist)
CREATE TABLE IF NOT EXISTS channel_performance_ratios (
    channel_id TEXT PRIMARY KEY,
    channel_name TEXT,
    avg_first_week_views NUMERIC,
    sample_count INTEGER,
    performance_ratio NUMERIC,
    calculation_method TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Function to calculate and store channel performance ratios
CREATE OR REPLACE FUNCTION update_channel_performance_ratios()
RETURNS TABLE(updated_count INTEGER, total_channels INTEGER) AS $$
DECLARE
    v_updated INTEGER := 0;
    v_total INTEGER;
    v_global_p7_median NUMERIC;
BEGIN
    -- Get the smoothed global median at day 7
    SELECT p50_views INTO v_global_p7_median
    FROM performance_envelopes
    WHERE day_since_published = 7;
    
    IF v_global_p7_median IS NULL THEN
        RAISE EXCEPTION 'No envelope data found for day 7';
    END IF;
    
    RAISE NOTICE 'Global P50 at day 7: % views', v_global_p7_median;
    
    -- Calculate channel ratios from first-week performance
    WITH channel_first_week_stats AS (
        SELECT 
            v.channel_id,
            v.channel_name,
            AVG(vs.view_count) as avg_first_week_views,
            COUNT(DISTINCT v.id) as video_count
        FROM videos v
        JOIN view_snapshots vs ON v.id = vs.video_id
        WHERE vs.days_since_published = 7  -- Use day 7 specifically for consistency
        AND v.published_at < NOW() - INTERVAL '7 days'  -- Only videos old enough
        GROUP BY v.channel_id, v.channel_name
        HAVING COUNT(DISTINCT v.id) >= 3  -- Need at least 3 videos for reliability
    ),
    channel_ratios AS (
        SELECT 
            channel_id,
            channel_name,
            avg_first_week_views,
            video_count,
            avg_first_week_views / v_global_p7_median as performance_ratio,
            'first_week_avg' as calculation_method
        FROM channel_first_week_stats
    )
    INSERT INTO channel_performance_ratios (
        channel_id, 
        channel_name, 
        avg_first_week_views, 
        sample_count, 
        performance_ratio,
        calculation_method,
        updated_at
    )
    SELECT 
        channel_id,
        channel_name,
        ROUND(avg_first_week_views, 2),
        video_count,
        ROUND(performance_ratio, 3),
        calculation_method,
        NOW()
    FROM channel_ratios
    ON CONFLICT (channel_id) DO UPDATE SET
        channel_name = EXCLUDED.channel_name,
        avg_first_week_views = EXCLUDED.avg_first_week_views,
        sample_count = EXCLUDED.sample_count,
        performance_ratio = EXCLUDED.performance_ratio,
        calculation_method = EXCLUDED.calculation_method,
        updated_at = NOW();
    
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    SELECT COUNT(DISTINCT channel_id) INTO v_total FROM videos;
    
    RAISE NOTICE 'Updated % channel performance ratios out of % total channels', v_updated, v_total;
    
    RETURN QUERY SELECT v_updated, v_total;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STEP 2: Video Performance Score Updates
-- ============================================

-- Function to update all video performance scores
CREATE OR REPLACE FUNCTION update_all_video_performance_scores(batch_size INTEGER DEFAULT 5000)
RETURNS TABLE(updated_count INTEGER, total_videos INTEGER) AS $$
DECLARE
    v_updated INTEGER := 0;
    v_total INTEGER;
    v_offset INTEGER := 0;
    v_batch_count INTEGER;
BEGIN
    -- Get total count
    SELECT COUNT(*) INTO v_total 
    FROM videos 
    WHERE published_at IS NOT NULL;
    
    RAISE NOTICE 'Starting video score update for % videos', v_total;
    
    -- Process in batches
    LOOP
        WITH video_batch AS (
            SELECT 
                v.id,
                v.view_count,
                v.channel_id,
                LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER) as days_old
            FROM videos v
            WHERE v.published_at IS NOT NULL
            ORDER BY v.id
            LIMIT batch_size
            OFFSET v_offset
        ),
        score_calculation AS (
            SELECT 
                vb.id,
                vb.view_count,
                vb.days_old,
                pe.p50_views as global_median,
                COALESCE(cpr.performance_ratio, 1.0) as channel_ratio,
                -- Expected views = global median * channel ratio
                (pe.p50_views * COALESCE(cpr.performance_ratio, 1.0)) as expected_views,
                -- Performance ratio = actual / expected
                CASE 
                    WHEN pe.p50_views > 0 THEN
                        vb.view_count::FLOAT / (pe.p50_views * COALESCE(cpr.performance_ratio, 1.0))
                    ELSE NULL
                END as performance_ratio
            FROM video_batch vb
            LEFT JOIN performance_envelopes pe ON pe.day_since_published = vb.days_old
            LEFT JOIN channel_performance_ratios cpr ON cpr.channel_id = vb.channel_id
        )
        UPDATE videos v
        SET 
            envelope_performance_ratio = sc.performance_ratio,
            envelope_performance_category = CASE
                WHEN sc.performance_ratio > 3 THEN 'viral'
                WHEN sc.performance_ratio >= 1.5 THEN 'outperforming'
                WHEN sc.performance_ratio >= 0.5 THEN 'on_track'
                WHEN sc.performance_ratio >= 0.2 THEN 'underperforming'
                ELSE 'poor'
            END
        FROM score_calculation sc
        WHERE v.id = sc.id
        AND sc.performance_ratio IS NOT NULL;
        
        GET DIAGNOSTICS v_batch_count = ROW_COUNT;
        
        EXIT WHEN v_batch_count = 0;
        
        v_updated := v_updated + v_batch_count;
        v_offset := v_offset + batch_size;
        
        -- Progress update every 10 batches
        IF (v_offset / batch_size) % 10 = 0 THEN
            RAISE NOTICE 'Progress: % / % videos updated (%.1f%%)', 
                v_updated, v_total, (v_updated::FLOAT / v_total * 100);
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Video score update complete: % videos updated', v_updated;
    
    RETURN QUERY SELECT v_updated, v_total;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STEP 3: Master Update Function
-- ============================================

-- Master function that runs the complete update in correct order
CREATE OR REPLACE FUNCTION update_complete_performance_system()
RETURNS TABLE(
    step TEXT,
    updated_count INTEGER,
    total_count INTEGER,
    execution_time INTERVAL
) AS $$
DECLARE
    v_start_time TIMESTAMP;
    v_end_time TIMESTAMP;
    v_updated INTEGER;
    v_total INTEGER;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'STARTING COMPLETE PERFORMANCE UPDATE';
    RAISE NOTICE '========================================';
    
    -- Step 1: Update channel performance ratios
    v_start_time := clock_timestamp();
    
    SELECT * INTO v_updated, v_total FROM update_channel_performance_ratios();
    
    v_end_time := clock_timestamp();
    RETURN QUERY SELECT 
        'Channel Performance Ratios'::TEXT,
        v_updated,
        v_total,
        (v_end_time - v_start_time);
    
    -- Step 2: Update all video scores
    v_start_time := clock_timestamp();
    
    SELECT * INTO v_updated, v_total FROM update_all_video_performance_scores();
    
    v_end_time := clock_timestamp();
    RETURN QUERY SELECT 
        'Video Performance Scores'::TEXT,
        v_updated,
        v_total,
        (v_end_time - v_start_time);
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'COMPLETE PERFORMANCE UPDATE FINISHED';
    RAISE NOTICE '========================================';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STEP 4: Incremental Update Functions
-- ============================================

-- Function for daily incremental updates (just recent videos)
CREATE OR REPLACE FUNCTION update_recent_performance_scores()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Update scores for videos with recent tracking activity
    WITH recent_videos AS (
        SELECT DISTINCT video_id
        FROM view_snapshots
        WHERE snapshot_date >= CURRENT_DATE - INTERVAL '2 days'
    ),
    video_data AS (
        SELECT 
            v.id,
            v.view_count,
            v.channel_id,
            LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER) as days_old
        FROM videos v
        WHERE v.id IN (SELECT video_id FROM recent_videos)
        AND v.published_at IS NOT NULL
    )
    UPDATE videos v
    SET 
        envelope_performance_ratio = 
            v.view_count::FLOAT / NULLIF(
                pe.p50_views * COALESCE(cpr.performance_ratio, 1.0),
                0
            ),
        envelope_performance_category = CASE
            WHEN (v.view_count::FLOAT / NULLIF(pe.p50_views * COALESCE(cpr.performance_ratio, 1.0), 0)) > 3 THEN 'viral'
            WHEN (v.view_count::FLOAT / NULLIF(pe.p50_views * COALESCE(cpr.performance_ratio, 1.0), 0)) >= 1.5 THEN 'outperforming'
            WHEN (v.view_count::FLOAT / NULLIF(pe.p50_views * COALESCE(cpr.performance_ratio, 1.0), 0)) >= 0.5 THEN 'on_track'
            WHEN (v.view_count::FLOAT / NULLIF(pe.p50_views * COALESCE(cpr.performance_ratio, 1.0), 0)) >= 0.2 THEN 'underperforming'
            ELSE 'poor'
        END
    FROM video_data vd
    LEFT JOIN performance_envelopes pe ON pe.day_since_published = vd.days_old
    LEFT JOIN channel_performance_ratios cpr ON cpr.channel_id = vd.channel_id
    WHERE v.id = vd.id;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    RAISE NOTICE 'Updated % recent video scores', v_count;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STEP 5: Create Indexes for Performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_channel_performance_ratios_channel_id 
ON channel_performance_ratios(channel_id);

CREATE INDEX IF NOT EXISTS idx_videos_performance_update 
ON videos(id, channel_id, published_at) 
WHERE published_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_view_snapshots_day7 
ON view_snapshots(video_id, days_since_published, view_count) 
WHERE days_since_published = 7;

-- ============================================
-- USAGE INSTRUCTIONS
-- ============================================

-- MANUAL EXECUTION (RUN NOW):
-- SELECT * FROM update_complete_performance_system();

-- INDIVIDUAL STEPS:
-- SELECT * FROM update_channel_performance_ratios();
-- SELECT * FROM update_all_video_performance_scores();

-- DAILY INCREMENTAL:
-- SELECT update_recent_performance_scores();

-- ============================================
-- CRON JOB SETUP (OPTIONAL)
-- ============================================

-- Daily incremental update at 4 AM PT:
/*
SELECT cron.schedule(
    'update-recent-performance-daily',
    '0 4 * * *',
    'SELECT update_recent_performance_scores();'
);
*/

-- Weekly full refresh on Sundays at 3 AM PT:
/*
SELECT cron.schedule(
    'update-complete-performance-weekly',
    '0 3 * * 0',
    'SELECT * FROM update_complete_performance_system();'
);
*/

-- Monthly channel ratio recalculation (1st of month at 2 AM PT):
/*
SELECT cron.schedule(
    'update-channel-ratios-monthly',
    '0 2 1 * *',
    'SELECT * FROM update_channel_performance_ratios();'
);
*/