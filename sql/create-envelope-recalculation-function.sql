-- Function to recalculate performance envelopes with 7-day smoothing
-- This should be run daily or weekly via pg_cron

CREATE OR REPLACE FUNCTION recalculate_performance_envelopes_with_smoothing()
RETURNS void AS $$
DECLARE
    v_record RECORD;
    v_day INTEGER;
    v_percentiles RECORD;
    v_smoothed_data JSONB;
BEGIN
    -- Create temporary table for raw percentiles
    CREATE TEMP TABLE temp_raw_envelopes (
        day_since_published INTEGER PRIMARY KEY,
        p10_views INTEGER,
        p25_views INTEGER,
        p50_views INTEGER,
        p75_views INTEGER,
        p90_views INTEGER,
        sample_count INTEGER
    );

    -- Calculate raw percentiles for each day (0-3650)
    FOR v_day IN 0..3650 LOOP
        -- Get percentiles for this day
        SELECT 
            COALESCE(PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY view_count)::INTEGER, 0) AS p10,
            COALESCE(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY view_count)::INTEGER, 0) AS p25,
            COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY view_count)::INTEGER, 0) AS p50,
            COALESCE(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY view_count)::INTEGER, 0) AS p75,
            COALESCE(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY view_count)::INTEGER, 0) AS p90,
            COUNT(*) AS cnt
        INTO v_percentiles
        FROM view_snapshots
        WHERE days_since_published = v_day
        AND view_count IS NOT NULL;

        -- Only insert if we have at least 10 samples
        IF v_percentiles.cnt >= 10 THEN
            INSERT INTO temp_raw_envelopes 
            VALUES (v_day, v_percentiles.p10, v_percentiles.p25, v_percentiles.p50, 
                    v_percentiles.p75, v_percentiles.p90, v_percentiles.cnt);
        END IF;
    END LOOP;

    -- Apply 7-day rolling average smoothing
    -- Using a window function with frame clause for centered window
    WITH smoothed AS (
        SELECT 
            day_since_published,
            -- Average over 7-day centered window (3 days before, current day, 3 days after)
            AVG(p10_views) OVER (
                ORDER BY day_since_published 
                ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING
            )::INTEGER AS p10_smooth,
            AVG(p25_views) OVER (
                ORDER BY day_since_published 
                ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING
            )::INTEGER AS p25_smooth,
            AVG(p50_views) OVER (
                ORDER BY day_since_published 
                ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING
            )::INTEGER AS p50_smooth,
            AVG(p75_views) OVER (
                ORDER BY day_since_published 
                ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING
            )::INTEGER AS p75_smooth,
            AVG(p90_views) OVER (
                ORDER BY day_since_published 
                ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING
            )::INTEGER AS p90_smooth,
            sample_count
        FROM temp_raw_envelopes
    )
    -- Update the performance_envelopes table
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
        p10_smooth,
        p25_smooth,
        p50_smooth,
        p75_smooth,
        p90_smooth,
        sample_count,
        NOW()
    FROM smoothed
    ON CONFLICT (day_since_published) DO UPDATE SET
        p10_views = EXCLUDED.p10_views,
        p25_views = EXCLUDED.p25_views,
        p50_views = EXCLUDED.p50_views,
        p75_views = EXCLUDED.p75_views,
        p90_views = EXCLUDED.p90_views,
        sample_count = EXCLUDED.sample_count,
        updated_at = NOW();

    -- Clean up
    DROP TABLE temp_raw_envelopes;

    RAISE NOTICE 'Performance envelopes recalculated with 7-day smoothing at %', NOW();
END;
$$ LANGUAGE plpgsql;

-- Create a cron job to run this weekly (Sundays at 3 AM PT)
-- Note: You'll need to run this separately after creating the function
/*
SELECT cron.schedule(
    'recalculate-performance-envelopes',  -- job name
    '0 3 * * 0',                          -- cron expression (Sundays at 3 AM)
    'SELECT recalculate_performance_envelopes_with_smoothing();'
);
*/

-- To run manually:
-- SELECT recalculate_performance_envelopes_with_smoothing();