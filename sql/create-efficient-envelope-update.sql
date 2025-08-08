-- Efficient performance envelope update system
-- Uses single-pass aggregation and incremental updates

-- 1. Create a materialized view for raw percentiles (run once)
CREATE MATERIALIZED VIEW IF NOT EXISTS performance_envelopes_raw AS
SELECT 
    days_since_published,
    PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY view_count)::INTEGER AS p10_views,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY view_count)::INTEGER AS p25_views,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY view_count)::INTEGER AS p50_views,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY view_count)::INTEGER AS p75_views,
    PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY view_count)::INTEGER AS p90_views,
    COUNT(*)::INTEGER AS sample_count
FROM view_snapshots
WHERE view_count IS NOT NULL
AND days_since_published >= 0 
AND days_since_published <= 3650
GROUP BY days_since_published
HAVING COUNT(*) >= 10;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_performance_envelopes_raw_day 
ON performance_envelopes_raw(days_since_published);

-- 2. Function to apply smoothing and update the main table
CREATE OR REPLACE FUNCTION update_performance_envelopes_from_raw()
RETURNS void AS $$
BEGIN
    -- Single query to apply 7-day smoothing and update
    INSERT INTO performance_envelopes (
        day_since_published,
        p10_views,
        p25_views,
        p50_views,
        p75_views,
        p90_views,
        sample_count,
        updated_at
    )
    SELECT 
        day_since_published,
        -- 7-day centered rolling average
        AVG(p10_views) OVER w AS p10_views,
        AVG(p25_views) OVER w AS p25_views,
        AVG(p50_views) OVER w AS p50_views,
        AVG(p75_views) OVER w AS p75_views,
        AVG(p90_views) OVER w AS p90_views,
        sample_count,
        NOW() as updated_at
    FROM performance_envelopes_raw
    WINDOW w AS (
        ORDER BY days_since_published 
        ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING
    )
    ON CONFLICT (day_since_published) DO UPDATE SET
        p10_views = EXCLUDED.p10_views,
        p25_views = EXCLUDED.p25_views,
        p50_views = EXCLUDED.p50_views,
        p75_views = EXCLUDED.p75_views,
        p90_views = EXCLUDED.p90_views,
        sample_count = EXCLUDED.sample_count,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- 3. Refresh function (what cron job calls)
CREATE OR REPLACE FUNCTION refresh_performance_envelopes()
RETURNS void AS $$
BEGIN
    -- Refresh the materialized view (this is the heavy computation)
    REFRESH MATERIALIZED VIEW CONCURRENTLY performance_envelopes_raw;
    
    -- Apply smoothing and update main table (fast)
    PERFORM update_performance_envelopes_from_raw();
    
    RAISE NOTICE 'Performance envelopes refreshed at %', NOW();
END;
$$ LANGUAGE plpgsql;

-- 4. Weekly cron job (Sundays at 3 AM PT)
/*
SELECT cron.schedule(
    'refresh-performance-envelopes',
    '0 3 * * 0',
    'SELECT refresh_performance_envelopes();'
);
*/

-- 5. Optional: Incremental video score updates for recently changed videos
CREATE OR REPLACE FUNCTION update_recent_video_scores()
RETURNS void AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Update scores for videos tracked in last 7 days
    WITH recent_videos AS (
        SELECT DISTINCT video_id
        FROM view_snapshots
        WHERE snapshot_date >= CURRENT_DATE - INTERVAL '7 days'
        LIMIT 5000  -- Process in manageable batches
    )
    UPDATE videos v
    SET 
        envelope_performance_ratio = (
            SELECT v.view_count::FLOAT / NULLIF(pe.p50_views, 0)
            FROM performance_envelopes pe
            WHERE pe.day_since_published = 
                LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER)
        ),
        envelope_performance_category = CASE
            WHEN (v.view_count::FLOAT / NULLIF(
                (SELECT p50_views FROM performance_envelopes 
                 WHERE day_since_published = LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER)), 0)
            ) > 3 THEN 'viral'
            WHEN (v.view_count::FLOAT / NULLIF(
                (SELECT p50_views FROM performance_envelopes 
                 WHERE day_since_published = LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER)), 0)
            ) >= 1.5 THEN 'outperforming'
            WHEN (v.view_count::FLOAT / NULLIF(
                (SELECT p50_views FROM performance_envelopes 
                 WHERE day_since_published = LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER)), 0)
            ) >= 0.5 THEN 'on_track'
            WHEN (v.view_count::FLOAT / NULLIF(
                (SELECT p50_views FROM performance_envelopes 
                 WHERE day_since_published = LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER)), 0)
            ) >= 0.2 THEN 'underperforming'
            ELSE 'poor'
        END
    WHERE v.id IN (SELECT video_id FROM recent_videos);
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Updated % recent video scores', v_count;
END;
$$ LANGUAGE plpgsql;

-- Daily cron job for incremental score updates
/*
SELECT cron.schedule(
    'update-recent-video-scores',
    '0 4 * * *',  -- Daily at 4 AM PT
    'SELECT update_recent_video_scores();'
);
*/