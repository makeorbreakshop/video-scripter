-- ============================================
-- COMPLETE STORED PERFORMANCE SCORING SYSTEM
-- ============================================
-- This creates tables and functions to store channel performance ratios
-- and pre-calculate all video scores for fast search/display

-- ============================================
-- STEP 1: Create Channel Performance Ratios Table
-- ============================================

CREATE TABLE IF NOT EXISTS channel_performance_ratios (
    channel_id TEXT PRIMARY KEY,
    channel_name TEXT,
    baseline_views NUMERIC,  -- Average views at day 7 for this channel
    sample_count INTEGER,    -- Number of videos used in calculation
    performance_ratio NUMERIC, -- How much better/worse than global median
    confidence_score NUMERIC,  -- 0-1 based on sample size
    calculation_method TEXT,
    last_updated TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_channel_performance_ratios_updated 
ON channel_performance_ratios(last_updated DESC);

-- ============================================
-- STEP 2: Calculate Channel Performance Ratios
-- ============================================

CREATE OR REPLACE FUNCTION calculate_all_channel_ratios()
RETURNS TABLE(
    channels_updated INTEGER,
    total_channels INTEGER,
    global_p7_median NUMERIC
) AS $$
DECLARE
    v_global_p7_median NUMERIC;
    v_channels_updated INTEGER := 0;
    v_total_channels INTEGER;
BEGIN
    -- Get the smoothed global median at day 7
    SELECT p50_views INTO v_global_p7_median
    FROM performance_envelopes
    WHERE day_since_published = 7;
    
    IF v_global_p7_median IS NULL THEN
        RAISE EXCEPTION 'No envelope data found for day 7';
    END IF;
    
    RAISE NOTICE 'Global P50 at day 7: % views', v_global_p7_median;
    
    -- Calculate ratios for all channels with sufficient data
    WITH channel_stats AS (
        SELECT 
            v.channel_id,
            v.channel_name,
            -- Get day 7 performance for each video
            AVG(CASE 
                WHEN vs.days_since_published = 7 THEN vs.view_count 
                ELSE NULL 
            END) as avg_day7_views,
            COUNT(DISTINCT CASE 
                WHEN vs.days_since_published = 7 THEN v.id 
                ELSE NULL 
            END) as video_count
        FROM videos v
        INNER JOIN view_snapshots vs ON v.id = vs.video_id
        WHERE vs.days_since_published = 7
        AND v.published_at < NOW() - INTERVAL '7 days'
        GROUP BY v.channel_id, v.channel_name
    ),
    channel_ratios AS (
        SELECT 
            channel_id,
            channel_name,
            avg_day7_views as baseline_views,
            video_count as sample_count,
            -- Calculate ratio vs global median
            avg_day7_views / v_global_p7_median as performance_ratio,
            -- Confidence score (0-1) based on sample size
            LEAST(1.0, video_count::NUMERIC / 20.0) as confidence_score,
            'day7_average' as calculation_method
        FROM channel_stats
        WHERE video_count >= 3  -- Minimum 3 videos for reliability
    )
    INSERT INTO channel_performance_ratios (
        channel_id,
        channel_name,
        baseline_views,
        sample_count,
        performance_ratio,
        confidence_score,
        calculation_method,
        last_updated
    )
    SELECT 
        channel_id,
        channel_name,
        ROUND(baseline_views, 0),
        sample_count,
        ROUND(performance_ratio, 3),
        ROUND(confidence_score, 2),
        calculation_method,
        NOW()
    FROM channel_ratios
    ON CONFLICT (channel_id) DO UPDATE SET
        channel_name = EXCLUDED.channel_name,
        baseline_views = EXCLUDED.baseline_views,
        sample_count = EXCLUDED.sample_count,
        performance_ratio = EXCLUDED.performance_ratio,
        confidence_score = EXCLUDED.confidence_score,
        calculation_method = EXCLUDED.calculation_method,
        last_updated = NOW();
    
    GET DIAGNOSTICS v_channels_updated = ROW_COUNT;
    
    -- Get total channel count
    SELECT COUNT(DISTINCT channel_id) INTO v_total_channels FROM videos;
    
    RAISE NOTICE 'Updated % channel ratios out of % total channels', v_channels_updated, v_total_channels;
    RAISE NOTICE 'Channels without ratios will use 1.0x (global median)', v_total_channels - v_channels_updated;
    
    RETURN QUERY SELECT v_channels_updated, v_total_channels, v_global_p7_median;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STEP 3: Update All Video Performance Scores
-- ============================================

CREATE OR REPLACE FUNCTION update_all_video_scores(batch_size INTEGER DEFAULT 5000)
RETURNS TABLE(
    videos_updated INTEGER,
    total_videos INTEGER,
    execution_time INTERVAL
) AS $$
DECLARE
    v_updated INTEGER := 0;
    v_total INTEGER;
    v_batch_count INTEGER;
    v_offset INTEGER := 0;
    v_start_time TIMESTAMP;
BEGIN
    v_start_time := clock_timestamp();
    
    -- Get total count
    SELECT COUNT(*) INTO v_total FROM videos WHERE published_at IS NOT NULL;
    
    RAISE NOTICE 'Starting update for % videos in batches of %', v_total, batch_size;
    
    -- Process videos in batches
    LOOP
        WITH video_batch AS (
            SELECT 
                v.id,
                v.view_count,
                v.channel_id,
                v.published_at,
                -- Calculate age in days (max 10 years)
                LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER) as days_old
            FROM videos v
            WHERE v.published_at IS NOT NULL
            ORDER BY v.id
            LIMIT batch_size
            OFFSET v_offset
        ),
        score_calc AS (
            SELECT 
                vb.id,
                vb.view_count,
                vb.days_old,
                pe.p50_views as global_median,
                COALESCE(cpr.performance_ratio, 1.0) as channel_ratio,
                -- Calculate performance score with channel adjustment
                CASE 
                    WHEN pe.p50_views > 0 THEN
                        vb.view_count::FLOAT / (pe.p50_views * COALESCE(cpr.performance_ratio, 1.0))
                    ELSE NULL
                END as performance_score
            FROM video_batch vb
            LEFT JOIN performance_envelopes pe ON pe.day_since_published = vb.days_old
            LEFT JOIN channel_performance_ratios cpr ON cpr.channel_id = vb.channel_id
            WHERE pe.p50_views IS NOT NULL
        )
        UPDATE videos v
        SET 
            envelope_performance_ratio = ROUND(sc.performance_score::NUMERIC, 3),
            envelope_performance_category = CASE
                WHEN sc.performance_score > 3.0 THEN 'viral'
                WHEN sc.performance_score >= 1.5 THEN 'outperforming'
                WHEN sc.performance_score >= 0.5 THEN 'on_track'
                WHEN sc.performance_score >= 0.2 THEN 'underperforming'
                ELSE 'poor'
            END
        FROM score_calc sc
        WHERE v.id = sc.id
        AND sc.performance_score IS NOT NULL;
        
        GET DIAGNOSTICS v_batch_count = ROW_COUNT;
        
        EXIT WHEN v_batch_count = 0;
        
        v_updated := v_updated + v_batch_count;
        v_offset := v_offset + batch_size;
        
        -- Progress report every 20,000 videos
        IF v_updated % 20000 = 0 THEN
            RAISE NOTICE 'Progress: % / % videos (%.1f%%) - Elapsed: %', 
                v_updated, 
                v_total, 
                (v_updated::FLOAT / v_total * 100),
                (clock_timestamp() - v_start_time);
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Completed: % videos updated in %', v_updated, (clock_timestamp() - v_start_time);
    
    RETURN QUERY SELECT v_updated, v_total, (clock_timestamp() - v_start_time);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STEP 4: Master Update Function (Runs Everything)
-- ============================================

CREATE OR REPLACE FUNCTION refresh_all_performance_scores()
RETURNS TABLE(
    step_name TEXT,
    items_updated INTEGER,
    items_total INTEGER,
    duration INTERVAL
) AS $$
DECLARE
    v_start TIMESTAMP;
    v_updated INTEGER;
    v_total INTEGER;
    v_median NUMERIC;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'STARTING COMPLETE PERFORMANCE REFRESH';
    RAISE NOTICE '========================================';
    
    -- Step 1: Update channel ratios
    v_start := clock_timestamp();
    SELECT * INTO v_updated, v_total, v_median 
    FROM calculate_all_channel_ratios();
    
    RETURN QUERY SELECT 
        'Channel Performance Ratios'::TEXT,
        v_updated,
        v_total,
        (clock_timestamp() - v_start);
    
    -- Step 2: Update all video scores
    v_start := clock_timestamp();
    SELECT videos_updated, total_videos INTO v_updated, v_total 
    FROM update_all_video_scores();
    
    RETURN QUERY SELECT 
        'Video Performance Scores'::TEXT,
        v_updated,
        v_total,
        (clock_timestamp() - v_start);
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'PERFORMANCE REFRESH COMPLETE';
    RAISE NOTICE '========================================';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STEP 5: Quick Lookup Function for Search Pages
-- ============================================

CREATE OR REPLACE FUNCTION get_video_performance_badge(score NUMERIC)
RETURNS TEXT AS $$
BEGIN
    IF score IS NULL THEN
        RETURN NULL;
    ELSIF score >= 3.0 THEN
        RETURN '🚀 ' || ROUND(score * 100)::TEXT || '%';
    ELSIF score >= 1.5 THEN
        RETURN '✅ ' || ROUND(score * 100)::TEXT || '%';
    ELSIF score >= 0.8 THEN
        RETURN '📊 ' || ROUND(score * 100)::TEXT || '%';
    ELSIF score >= 0.5 THEN
        RETURN '⚠️ ' || ROUND(score * 100)::TEXT || '%';
    ELSE
        RETURN '🔴 ' || ROUND(score * 100)::TEXT || '%';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- STEP 6: Incremental Update for Recent Videos
-- ============================================

CREATE OR REPLACE FUNCTION update_recent_video_scores()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Update only videos tracked in last 2 days
    WITH recent_videos AS (
        SELECT DISTINCT vs.video_id, v.channel_id, v.view_count,
               LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER) as days_old
        FROM view_snapshots vs
        JOIN videos v ON v.id = vs.video_id
        WHERE vs.snapshot_date >= CURRENT_DATE - INTERVAL '2 days'
        AND v.published_at IS NOT NULL
    )
    UPDATE videos v
    SET 
        envelope_performance_ratio = ROUND(
            rv.view_count::FLOAT / NULLIF(
                pe.p50_views * COALESCE(cpr.performance_ratio, 1.0), 
                0
            )::NUMERIC, 3
        ),
        envelope_performance_category = CASE
            WHEN (rv.view_count::FLOAT / NULLIF(pe.p50_views * COALESCE(cpr.performance_ratio, 1.0), 0)) > 3 THEN 'viral'
            WHEN (rv.view_count::FLOAT / NULLIF(pe.p50_views * COALESCE(cpr.performance_ratio, 1.0), 0)) >= 1.5 THEN 'outperforming'
            WHEN (rv.view_count::FLOAT / NULLIF(pe.p50_views * COALESCE(cpr.performance_ratio, 1.0), 0)) >= 0.5 THEN 'on_track'
            WHEN (rv.view_count::FLOAT / NULLIF(pe.p50_views * COALESCE(cpr.performance_ratio, 1.0), 0)) >= 0.2 THEN 'underperforming'
            ELSE 'poor'
        END
    FROM recent_videos rv
    LEFT JOIN performance_envelopes pe ON pe.day_since_published = rv.days_old
    LEFT JOIN channel_performance_ratios cpr ON cpr.channel_id = rv.channel_id
    WHERE v.id = rv.video_id
    AND pe.p50_views IS NOT NULL;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    RAISE NOTICE 'Updated % recent video scores', v_count;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- INSTRUCTIONS TO RUN
-- ============================================

-- 1. First, create all the functions and tables:
--    Run this entire SQL file to create the system

-- 2. Then run the master refresh to populate everything:
--    SELECT * FROM refresh_all_performance_scores();
--    
--    This will:
--    - Calculate channel ratios for all channels (takes ~30 seconds)
--    - Update all 196K video scores (takes ~2-3 minutes)

-- 3. Test a search query to see the pre-calculated scores:
/*
SELECT 
    id,
    title,
    channel_name,
    view_count,
    envelope_performance_ratio as score,
    envelope_performance_category as category,
    get_video_performance_badge(envelope_performance_ratio) as badge
FROM videos
WHERE title ILIKE '%steak%'
ORDER BY envelope_performance_ratio DESC
LIMIT 20;
*/

-- 4. For ongoing updates, schedule these:
--    Daily: SELECT update_recent_video_scores();
--    Weekly: SELECT * FROM refresh_all_performance_scores();

-- ============================================
-- OPTIONAL: Create Cron Jobs
-- ============================================

/*
-- Daily incremental update at 4 AM PT
SELECT cron.schedule(
    'update-recent-scores-daily',
    '0 4 * * *',
    'SELECT update_recent_video_scores();'
);

-- Weekly full refresh on Sundays at 3 AM PT
SELECT cron.schedule(
    'refresh-all-scores-weekly', 
    '0 3 * * 0',
    'SELECT * FROM refresh_all_performance_scores();'
);
*/