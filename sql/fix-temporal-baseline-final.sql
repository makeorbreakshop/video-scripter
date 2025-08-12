-- FINAL FIX: Update calculate_video_channel_baseline to handle first videos correctly
-- This function is called by the import pipeline and triggers

CREATE OR REPLACE FUNCTION calculate_video_channel_baseline(p_video_id TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
    v_channel_id TEXT;
    v_published_at TIMESTAMP;
    v_baseline NUMERIC;
    v_video_position INTEGER;
BEGIN
    -- Get video info
    SELECT channel_id, published_at
    INTO v_channel_id, v_published_at
    FROM videos
    WHERE id = p_video_id;

    IF v_channel_id IS NULL THEN
        RETURN 1.0; -- Default baseline
    END IF;

    -- Check if this is the first video for the channel
    SELECT COUNT(*) + 1 INTO v_video_position
    FROM videos v
    WHERE v.channel_id = v_channel_id
    AND v.published_at < v_published_at
    AND v.is_short = false;

    -- First video always gets baseline of 1.0
    IF v_video_position = 1 THEN
        RETURN 1.0;
    END IF;

    -- Calculate baseline from previous videos (up to 10)
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
        LIMIT 10  -- Take up to 10, works with fewer
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

-- Also update the batch processing function to handle first videos correctly
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
    channel_baseline_at_publish = calculate_video_channel_baseline(videos.id),
    temporal_performance_score = CASE
      -- First video always gets score of 1.0
      WHEN NOT EXISTS (
        SELECT 1 FROM videos v2
        WHERE v2.channel_id = videos.channel_id
        AND v2.published_at < videos.published_at
        AND v2.is_short = false
      ) THEN 1.0
      -- Other videos: calculate score with capping
      WHEN calculate_video_channel_baseline(videos.id) > 0 THEN
        LEAST(
          ROUND((videos.view_count::numeric / calculate_video_channel_baseline(videos.id)), 3),
          99999.999
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

-- Create a safe batch fix function with proper capping
CREATE OR REPLACE FUNCTION fix_temporal_baselines_safe(batch_size INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  processed INTEGER;
  failed_count INTEGER;
BEGIN
  -- Process videos that need fixing
  WITH batch AS (
    SELECT id
    FROM videos
    WHERE (
      -- Videos with baseline = 1.0 that aren't first videos
      (channel_baseline_at_publish = 1.0 AND EXISTS (
        SELECT 1 FROM videos v2
        WHERE v2.channel_id = videos.channel_id
        AND v2.published_at < videos.published_at
        AND v2.is_short = false
      ))
      -- Or videos with NULL baseline
      OR channel_baseline_at_publish IS NULL
    )
    AND is_short = false
    LIMIT batch_size
  )
  UPDATE videos v
  SET 
    channel_baseline_at_publish = calculate_video_channel_baseline(v.id),
    temporal_performance_score = CASE
      -- First video check
      WHEN NOT EXISTS (
        SELECT 1 FROM videos v2
        WHERE v2.channel_id = v.channel_id
        AND v2.published_at < v.published_at
        AND v2.is_short = false
      ) THEN 1.0
      -- Regular calculation with capping
      WHEN calculate_video_channel_baseline(v.id) > 0 THEN
        LEAST(
          ROUND((v.view_count::numeric / calculate_video_channel_baseline(v.id)), 3),
          99999.999
        )
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
      WHERE (
        (channel_baseline_at_publish = 1.0 AND EXISTS (
          SELECT 1 FROM videos v2
          WHERE v2.channel_id = videos.channel_id
          AND v2.published_at < videos.published_at
          AND v2.is_short = false
        ))
        OR channel_baseline_at_publish IS NULL
      )
      AND is_short = false
    )
  );
END;
$$;

-- Test the function update
SELECT 'Functions updated! Now run one test:' as status;