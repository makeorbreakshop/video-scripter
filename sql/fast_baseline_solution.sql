-- FAST BASELINE SOLUTION - Process everything in one go with optimizations

-- Step 1: Clear shorts baselines first (fast operation)
UPDATE videos 
SET rolling_baseline_views = NULL 
WHERE is_youtube_short(duration, title, description);

-- Step 2: Create the most optimized index possible
CREATE INDEX IF NOT EXISTS idx_videos_baseline_calc 
ON videos (channel_id, published_at, view_count) 
WHERE NOT is_youtube_short(duration, title, description) AND view_count > 0;

-- Step 3: Use a single UPDATE with optimized subquery
-- This should complete in minutes, not hours
UPDATE videos v1
SET rolling_baseline_views = baseline_calc.avg_views
FROM (
  SELECT 
    v1.id,
    v1.channel_id,
    v1.published_at,
    (
      SELECT AVG(v2.view_count)::INTEGER
      FROM videos v2
      WHERE v2.channel_id = v1.channel_id
      AND v2.published_at >= v1.published_at - INTERVAL '1 year'
      AND v2.published_at < v1.published_at
      AND NOT is_youtube_short(v2.duration, v2.title, v2.description)
      AND v2.view_count > 0
    ) as avg_views
  FROM videos v1
  WHERE NOT is_youtube_short(v1.duration, v1.title, v1.description)
) baseline_calc
WHERE v1.id = baseline_calc.id
AND baseline_calc.avg_views IS NOT NULL;

-- Step 4: For future videos, use the trigger
CREATE OR REPLACE FUNCTION calculate_baseline_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF is_youtube_short(NEW.duration, NEW.title, NEW.description) THEN
    NEW.rolling_baseline_views := NULL;
    RETURN NEW;
  END IF;

  SELECT AVG(view_count)::INTEGER INTO NEW.rolling_baseline_views
  FROM videos
  WHERE channel_id = NEW.channel_id
  AND published_at >= NEW.published_at - INTERVAL '1 year'
  AND published_at < NEW.published_at
  AND NOT is_youtube_short(duration, title, description)
  AND view_count > 0;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS calculate_baseline_on_video_insert ON videos;
CREATE TRIGGER calculate_baseline_on_video_insert
  BEFORE INSERT ON videos
  FOR EACH ROW
  EXECUTE FUNCTION calculate_baseline_on_insert();

-- Step 5: If the above still times out, use this more aggressive batch approach
CREATE OR REPLACE FUNCTION fast_baseline_update()
RETURNS TABLE(channels_processed INTEGER, videos_updated INTEGER) AS $$
DECLARE
  channel_count INTEGER := 0;
  total_updated INTEGER := 0;
  channel_record RECORD;
BEGIN
  -- Process one channel at a time (much faster than individual videos)
  FOR channel_record IN 
    SELECT DISTINCT channel_id, COUNT(*) as video_count
    FROM videos 
    WHERE NOT is_youtube_short(duration, title, description)
    GROUP BY channel_id
    ORDER BY video_count DESC
  LOOP
    -- Update all videos for this channel at once
    UPDATE videos v1
    SET rolling_baseline_views = (
      SELECT AVG(v2.view_count)::INTEGER
      FROM videos v2
      WHERE v2.channel_id = v1.channel_id
      AND v2.published_at >= v1.published_at - INTERVAL '1 year'
      AND v2.published_at < v1.published_at
      AND NOT is_youtube_short(v2.duration, v2.title, v2.description)
      AND v2.view_count > 0
    )
    WHERE v1.channel_id = channel_record.channel_id
    AND NOT is_youtube_short(v1.duration, v1.title, v1.description)
    AND v1.rolling_baseline_views IS NULL;
    
    channel_count := channel_count + 1;
    total_updated := total_updated + channel_record.video_count;
    
    -- Log progress every 10 channels
    IF channel_count % 10 = 0 THEN
      RAISE NOTICE 'Processed % channels, % videos so far', channel_count, total_updated;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT channel_count, total_updated;
END;
$$ LANGUAGE plpgsql;

-- FASTEST OPTION: If you have direct database access, run this outside of Supabase dashboard
-- This processes everything in parallel using PostgreSQL's native capabilities
-- and should complete in under 10 minutes on a decent server