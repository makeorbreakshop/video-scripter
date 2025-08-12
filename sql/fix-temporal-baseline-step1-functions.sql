-- STEP 1: Fix the functions first (this is quick and won't timeout)
-- Run this FIRST in Supabase SQL Editor

-- Fix 1: Update the trigger_temporal_baseline_processing function
CREATE OR REPLACE FUNCTION trigger_temporal_baseline_processing(batch_size INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  processed INTEGER;
BEGIN
  WITH batch AS (
    SELECT v1.id, v1.channel_id, v1.published_at, v1.view_count
    FROM videos v1
    WHERE v1.channel_baseline_at_publish IS NULL
    AND v1.is_short = false
    LIMIT batch_size
  )
  UPDATE videos
  SET
    -- TEMPORAL BASELINE: avg of last 10 videos (NO TIME RESTRICTION)
    channel_baseline_at_publish = COALESCE(
      (
        SELECT AVG(recent.view_count)
        FROM (
          SELECT v2.view_count
          FROM videos v2
          WHERE v2.channel_id = videos.channel_id
          AND v2.published_at < videos.published_at
          -- REMOVED: AND v2.published_at >= videos.published_at - INTERVAL '30 days'
          AND v2.is_short = false
          AND v2.view_count > 0
          ORDER BY v2.published_at DESC
          LIMIT 10
        ) recent
      ),
      1.0
    ),
    -- TEMPORAL PERFORMANCE SCORE: current views / temporal baseline
    temporal_performance_score = CASE
      WHEN COALESCE(
        (
          SELECT AVG(recent.view_count)
          FROM (
            SELECT v2.view_count
            FROM videos v2
            WHERE v2.channel_id = videos.channel_id
            AND v2.published_at < videos.published_at
            -- REMOVED: AND v2.published_at >= videos.published_at - INTERVAL '30 days'
            AND v2.is_short = false
            AND v2.view_count > 0
            ORDER BY v2.published_at DESC
            LIMIT 10
          ) recent
        ),
        1.0
      ) > 0 THEN videos.view_count::numeric / COALESCE(
        (
          SELECT AVG(recent.view_count)
          FROM (
            SELECT v2.view_count
            FROM videos v2
            WHERE v2.channel_id = videos.channel_id
            AND v2.published_at < videos.published_at
            -- REMOVED: AND v2.published_at >= videos.published_at - INTERVAL '30 days'
            AND v2.is_short = false
            AND v2.view_count > 0
            ORDER BY v2.published_at DESC
            LIMIT 10
          ) recent
        ),
        1.0
      )
      ELSE NULL
    END
  FROM batch
  WHERE videos.id = batch.id;

  GET DIAGNOSTICS processed = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'videos_updated', processed
  );
END;
$$;

-- Fix 2: Also update calculate_video_channel_baseline to match
-- (This function is called by the insert trigger)
CREATE OR REPLACE FUNCTION calculate_video_channel_baseline(p_video_id TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
    v_channel_id TEXT;
    v_published_at TIMESTAMP;
    v_baseline NUMERIC;
BEGIN
    -- Get video info
    SELECT channel_id, published_at
    INTO v_channel_id, v_published_at
    FROM videos
    WHERE id = p_video_id;

    IF v_channel_id IS NULL THEN
        RETURN 1.0; -- Default baseline
    END IF;

    -- Calculate baseline from previous 10 videos (NO TIME RESTRICTION)
    WITH previous_videos AS (
        SELECT
            v.id,
            v.view_count,
            GREATEST(1, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER) as current_age,
            30 as target_age
        FROM videos v
        WHERE v.channel_id = v_channel_id
        AND v.published_at < v_published_at
        AND v.published_at IS NOT NULL
        AND v.view_count > 0
        AND v.is_short = false  -- EXCLUDE SHORTS
        ORDER BY v.published_at DESC
        LIMIT 10
    ),
    estimated_day30 AS (
        SELECT
            pv.id,
            -- Estimate day-30 views using curve backfill
            CASE
                WHEN pv.current_age <= 30 THEN pv.view_count
                ELSE pv.view_count * (pe30.p50_views::FLOAT / NULLIF(pe_current.p50_views, 1))
            END as estimated_day30_views
        FROM previous_videos pv
        LEFT JOIN performance_envelopes pe30 ON pe30.day_since_published = 30
        LEFT JOIN performance_envelopes pe_current ON pe_current.day_since_published = LEAST(pv.current_age, 3650)
    ),
    channel_median AS (
        SELECT
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY estimated_day30_views) as median_day30
        FROM estimated_day30
    )
    SELECT
        ROUND(COALESCE(
            cm.median_day30 / NULLIF((SELECT p50_views FROM performance_envelopes WHERE day_since_published = 30), 0),
            1.0
        )::NUMERIC, 3)
    INTO v_baseline
    FROM channel_median cm;

    RETURN COALESCE(v_baseline, 1.0);
END;
$$;

-- Step 3: Create a function to fix baselines that we can call repeatedly
CREATE OR REPLACE FUNCTION fix_temporal_baselines_batch(batch_size INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  processed INTEGER;
BEGIN
  -- Process a batch of videos with baseline = 1.0
  WITH batch AS (
    SELECT id
    FROM videos
    WHERE channel_baseline_at_publish = 1.0
    AND import_date >= '2025-08-09'
    AND is_short = false
    LIMIT batch_size
  )
  UPDATE videos v
  SET 
    channel_baseline_at_publish = calculate_video_channel_baseline(v.id),
    temporal_performance_score = CASE 
      WHEN calculate_video_channel_baseline(v.id) > 0 
      THEN v.view_count::numeric / calculate_video_channel_baseline(v.id)
      ELSE NULL
    END
  FROM batch b
  WHERE v.id = b.id;
  
  GET DIAGNOSTICS processed = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'videos_updated', processed,
    'remaining', (
      SELECT COUNT(*) 
      FROM videos 
      WHERE channel_baseline_at_publish = 1.0 
      AND import_date >= '2025-08-09' 
      AND is_short = false
    )
  );
END;
$$;

-- Test that the functions were created successfully
SELECT 'Functions updated successfully! Now run fix-temporal-baseline-step2-process.js to fix the data.' as status;