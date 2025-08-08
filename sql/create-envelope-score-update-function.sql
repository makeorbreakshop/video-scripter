-- Function to update envelope performance scores for all videos
-- This accounts for channel-specific performance multipliers

CREATE OR REPLACE FUNCTION update_all_envelope_scores(batch_size INTEGER DEFAULT 10000)
RETURNS TABLE(updated_count INTEGER, total_videos INTEGER) AS $$
DECLARE
    v_updated INTEGER := 0;
    v_total INTEGER;
    v_batch_count INTEGER := 0;
BEGIN
    -- Get total count
    SELECT COUNT(*) INTO v_total FROM videos WHERE published_at IS NOT NULL;
    
    RAISE NOTICE 'Starting envelope score update for % videos', v_total;
    
    -- Create temp table for channel baselines
    CREATE TEMP TABLE IF NOT EXISTS temp_channel_baselines AS
    WITH channel_first_week AS (
        SELECT 
            v.channel_id,
            AVG(vs.view_count) as avg_first_week_views,
            COUNT(DISTINCT v.id) as video_count
        FROM videos v
        JOIN view_snapshots vs ON v.id = vs.video_id
        WHERE vs.days_since_published BETWEEN 1 AND 7
        GROUP BY v.channel_id
        HAVING COUNT(DISTINCT v.id) >= 3  -- Need at least 3 videos for reliable baseline
    )
    SELECT 
        channel_id,
        avg_first_week_views,
        video_count,
        -- Calculate channel performance ratio vs global median
        avg_first_week_views / NULLIF(
            (SELECT p50_views FROM performance_envelopes WHERE day_since_published = 7),
            0
        ) as channel_ratio
    FROM channel_first_week;
    
    -- Add index for performance
    CREATE INDEX IF NOT EXISTS idx_temp_channel_baselines ON temp_channel_baselines(channel_id);
    
    RAISE NOTICE 'Calculated baselines for % channels', (SELECT COUNT(*) FROM temp_channel_baselines);
    
    -- Update videos in batches
    LOOP
        WITH batch AS (
            SELECT v.id, v.view_count, v.published_at, v.channel_id,
                   LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER) as days_old,
                   COALESCE(cb.channel_ratio, 1.0) as channel_multiplier
            FROM videos v
            LEFT JOIN temp_channel_baselines cb ON v.channel_id = cb.channel_id
            WHERE v.published_at IS NOT NULL
            ORDER BY v.id
            LIMIT batch_size
            OFFSET v_batch_count * batch_size
        ),
        scores AS (
            SELECT 
                b.id,
                b.view_count,
                b.days_old,
                b.channel_multiplier,
                pe.p50_views,
                -- Calculate expected views (global envelope * channel multiplier)
                (pe.p50_views * b.channel_multiplier) as expected_views,
                -- Calculate performance ratio
                CASE 
                    WHEN pe.p50_views > 0 AND b.channel_multiplier > 0 THEN
                        b.view_count::FLOAT / (pe.p50_views * b.channel_multiplier)
                    ELSE NULL
                END as ratio
            FROM batch b
            LEFT JOIN performance_envelopes pe ON pe.day_since_published = b.days_old
        )
        UPDATE videos v
        SET 
            envelope_performance_ratio = s.ratio,
            envelope_performance_category = CASE
                WHEN s.ratio > 3 THEN 'viral'
                WHEN s.ratio >= 1.5 THEN 'outperforming'
                WHEN s.ratio >= 0.5 THEN 'on_track'
                WHEN s.ratio >= 0.2 THEN 'underperforming'
                ELSE 'poor'
            END
        FROM scores s
        WHERE v.id = s.id
        AND s.ratio IS NOT NULL;
        
        GET DIAGNOSTICS v_batch_count = ROW_COUNT;
        
        EXIT WHEN v_batch_count = 0;
        
        v_updated := v_updated + v_batch_count;
        v_batch_count := v_batch_count + 1;
        
        -- Progress update every 10 batches
        IF v_batch_count % 10 = 0 THEN
            RAISE NOTICE 'Progress: % / % videos updated', v_updated, v_total;
        END IF;
    END LOOP;
    
    -- Clean up
    DROP TABLE IF EXISTS temp_channel_baselines;
    
    RAISE NOTICE 'Envelope score update complete: % videos updated', v_updated;
    
    RETURN QUERY SELECT v_updated, v_total;
END;
$$ LANGUAGE plpgsql;

-- Function for incremental updates (just recent videos)
CREATE OR REPLACE FUNCTION update_recent_envelope_scores()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Update scores for videos with recent snapshots
    WITH recent_videos AS (
        SELECT DISTINCT video_id
        FROM view_snapshots
        WHERE snapshot_date >= CURRENT_DATE - INTERVAL '2 days'
    ),
    channel_baselines AS (
        SELECT 
            v.channel_id,
            AVG(vs.view_count) / NULLIF(
                (SELECT p50_views FROM performance_envelopes WHERE day_since_published = 7),
                0
            ) as channel_ratio
        FROM videos v
        JOIN view_snapshots vs ON v.id = vs.video_id
        WHERE vs.days_since_published BETWEEN 1 AND 7
        GROUP BY v.channel_id
        HAVING COUNT(DISTINCT v.id) >= 3
    )
    UPDATE videos v
    SET 
        envelope_performance_ratio = 
            v.view_count::FLOAT / NULLIF(
                pe.p50_views * COALESCE(cb.channel_ratio, 1.0),
                0
            ),
        envelope_performance_category = CASE
            WHEN (v.view_count::FLOAT / NULLIF(pe.p50_views * COALESCE(cb.channel_ratio, 1.0), 0)) > 3 THEN 'viral'
            WHEN (v.view_count::FLOAT / NULLIF(pe.p50_views * COALESCE(cb.channel_ratio, 1.0), 0)) >= 1.5 THEN 'outperforming'
            WHEN (v.view_count::FLOAT / NULLIF(pe.p50_views * COALESCE(cb.channel_ratio, 1.0), 0)) >= 0.5 THEN 'on_track'
            WHEN (v.view_count::FLOAT / NULLIF(pe.p50_views * COALESCE(cb.channel_ratio, 1.0), 0)) >= 0.2 THEN 'underperforming'
            ELSE 'poor'
        END
    FROM performance_envelopes pe
    LEFT JOIN channel_baselines cb ON v.channel_id = cb.channel_id
    WHERE v.id IN (SELECT video_id FROM recent_videos)
    AND pe.day_since_published = LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER);
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    RAISE NOTICE 'Updated % recent video scores', v_count;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_videos_envelope_update 
ON videos(id, published_at, channel_id) 
WHERE published_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_view_snapshots_recent 
ON view_snapshots(snapshot_date, video_id) 
WHERE snapshot_date >= CURRENT_DATE - INTERVAL '7 days';

-- Usage:
-- SELECT * FROM update_all_envelope_scores();  -- Update all videos
-- SELECT update_recent_envelope_scores();       -- Update only recent videos

-- For cron job (daily at 4 AM PT):
/*
SELECT cron.schedule(
    'update-envelope-scores-daily',
    '0 4 * * *',
    'SELECT update_recent_envelope_scores();'
);
*/

-- For weekly full refresh (Sundays at 3 AM PT):
/*
SELECT cron.schedule(
    'update-all-envelope-scores-weekly',
    '0 3 * * 0',
    'SELECT * FROM update_all_envelope_scores();'
);
*/