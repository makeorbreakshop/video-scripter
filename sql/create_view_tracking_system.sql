-- View Tracking System for Smart Performance Analysis
-- Addresses the issue of performance scores being skewed for new videos

-- 1. Create view snapshots table for time-series data
CREATE TABLE IF NOT EXISTS view_snapshots (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  view_count INTEGER NOT NULL,
  like_count INTEGER,
  comment_count INTEGER,
  -- Calculated fields for analysis
  days_since_published INTEGER NOT NULL,
  daily_views_rate FLOAT, -- Views per day since last snapshot
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Prevent duplicate snapshots for same video/date
  UNIQUE(video_id, snapshot_date)
);

-- Indexes for efficient queries
CREATE INDEX idx_view_snapshots_video_date ON view_snapshots(video_id, snapshot_date DESC);
CREATE INDEX idx_view_snapshots_date ON view_snapshots(snapshot_date);
CREATE INDEX idx_view_snapshots_days_since ON view_snapshots(days_since_published);

-- 2. Create tracking priority table
CREATE TABLE IF NOT EXISTS view_tracking_priority (
  video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  priority_score FLOAT NOT NULL DEFAULT 0,
  priority_tier INTEGER NOT NULL DEFAULT 3, -- 1=highest, 3=lowest
  last_tracked DATE,
  next_track_date DATE,
  tracking_frequency_days INTEGER DEFAULT 30,
  reason TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tracking_priority_next_date ON view_tracking_priority(next_track_date) 
WHERE next_track_date IS NOT NULL;
CREATE INDEX idx_tracking_priority_tier ON view_tracking_priority(priority_tier, next_track_date);

-- 3. Function to calculate priority score
CREATE OR REPLACE FUNCTION calculate_tracking_priority(
  p_video_id TEXT,
  p_published_at TIMESTAMP,
  p_view_count INTEGER,
  p_channel_avg_views FLOAT,
  p_performance_ratio FLOAT
) RETURNS TABLE (
  priority_score FLOAT,
  priority_tier INTEGER,
  tracking_frequency_days INTEGER,
  reason TEXT
) AS $$
DECLARE
  v_age_days INTEGER;
  v_score FLOAT := 0;
  v_tier INTEGER := 3;
  v_frequency INTEGER := 30;
  v_reason TEXT := '';
BEGIN
  v_age_days := EXTRACT(DAY FROM NOW() - p_published_at);
  
  -- Priority scoring based on multiple factors
  
  -- 1. Age-based scoring (newer = higher priority)
  IF v_age_days <= 1 THEN
    v_score := v_score + 100;
    v_reason := v_reason || 'Brand new video; ';
  ELSIF v_age_days <= 7 THEN
    v_score := v_score + 50;
    v_reason := v_reason || 'First week critical; ';
  ELSIF v_age_days <= 30 THEN
    v_score := v_score + 25;
    v_reason := v_reason || 'First month important; ';
  ELSIF v_age_days <= 90 THEN
    v_score := v_score + 10;
    v_reason := v_reason || 'Recent video; ';
  END IF;
  
  -- 2. Performance-based scoring
  IF p_performance_ratio IS NOT NULL AND p_performance_ratio > 2 THEN
    v_score := v_score + 30;
    v_reason := v_reason || 'High performer; ';
  ELSIF p_performance_ratio IS NOT NULL AND p_performance_ratio < 0.5 THEN
    v_score := v_score + 15;
    v_reason := v_reason || 'Underperformer to analyze; ';
  END IF;
  
  -- 3. View velocity scoring (high view count relative to age)
  IF v_age_days > 0 AND p_view_count / v_age_days > COALESCE(p_channel_avg_views, 1000) / 30 THEN
    v_score := v_score + 20;
    v_reason := v_reason || 'High velocity; ';
  END IF;
  
  -- Determine tier and frequency
  IF v_score >= 80 THEN
    v_tier := 1;
    IF v_age_days <= 7 THEN
      v_frequency := 1; -- Daily for first week
    ELSIF v_age_days <= 30 THEN
      v_frequency := 3; -- Every 3 days for first month
    ELSE
      v_frequency := 7; -- Weekly
    END IF;
  ELSIF v_score >= 40 THEN
    v_tier := 2;
    IF v_age_days <= 30 THEN
      v_frequency := 7; -- Weekly
    ELSE
      v_frequency := 14; -- Bi-weekly
    END IF;
  ELSE
    v_tier := 3;
    v_frequency := 30; -- Monthly
  END IF;
  
  RETURN QUERY SELECT v_score, v_tier, v_frequency, TRIM(v_reason);
END;
$$ LANGUAGE plpgsql;

-- 4. Function to get next batch of videos to track (quota-aware)
CREATE OR REPLACE FUNCTION get_videos_to_track(
  p_daily_quota_limit INTEGER DEFAULT 5000,
  p_tier_1_percentage FLOAT DEFAULT 0.5,
  p_tier_2_percentage FLOAT DEFAULT 0.3,
  p_tier_3_percentage FLOAT DEFAULT 0.2
) RETURNS TABLE (
  video_id TEXT,
  priority_tier INTEGER,
  days_since_published INTEGER,
  last_view_count INTEGER
) AS $$
DECLARE
  v_tier_1_limit INTEGER;
  v_tier_2_limit INTEGER;
  v_tier_3_limit INTEGER;
BEGIN
  -- Calculate tier limits
  v_tier_1_limit := FLOOR(p_daily_quota_limit * p_tier_1_percentage);
  v_tier_2_limit := FLOOR(p_daily_quota_limit * p_tier_2_percentage);
  v_tier_3_limit := FLOOR(p_daily_quota_limit * p_tier_3_percentage);
  
  RETURN QUERY
  -- Tier 1: High priority videos
  (SELECT 
    vtp.video_id,
    vtp.priority_tier,
    EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER as days_since_published,
    v.view_count as last_view_count
  FROM view_tracking_priority vtp
  JOIN videos v ON v.id = vtp.video_id
  WHERE vtp.priority_tier = 1
    AND (vtp.next_track_date IS NULL OR vtp.next_track_date <= CURRENT_DATE)
  ORDER BY vtp.priority_score DESC
  LIMIT v_tier_1_limit)
  
  UNION ALL
  
  -- Tier 2: Medium priority videos
  (SELECT 
    vtp.video_id,
    vtp.priority_tier,
    EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER as days_since_published,
    v.view_count as last_view_count
  FROM view_tracking_priority vtp
  JOIN videos v ON v.id = vtp.video_id
  WHERE vtp.priority_tier = 2
    AND (vtp.next_track_date IS NULL OR vtp.next_track_date <= CURRENT_DATE)
  ORDER BY vtp.priority_score DESC
  LIMIT v_tier_2_limit)
  
  UNION ALL
  
  -- Tier 3: Low priority videos
  (SELECT 
    vtp.video_id,
    vtp.priority_tier,
    EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER as days_since_published,
    v.view_count as last_view_count
  FROM view_tracking_priority vtp
  JOIN videos v ON v.id = vtp.video_id
  WHERE vtp.priority_tier = 3
    AND (vtp.next_track_date IS NULL OR vtp.next_track_date <= CURRENT_DATE)
  ORDER BY vtp.priority_score DESC
  LIMIT v_tier_3_limit);
END;
$$ LANGUAGE plpgsql;

-- 5. Materialized view for performance metrics over time
CREATE MATERIALIZED VIEW IF NOT EXISTS video_performance_trends AS
SELECT 
  v.id as video_id,
  v.title,
  v.channel_id,
  v.published_at,
  v.view_count as current_views,
  -- First snapshot after key milestones
  (SELECT view_count FROM view_snapshots vs 
   WHERE vs.video_id = v.id AND vs.days_since_published <= 1 
   ORDER BY vs.snapshot_date LIMIT 1) as day_1_views,
  (SELECT view_count FROM view_snapshots vs 
   WHERE vs.video_id = v.id AND vs.days_since_published <= 7 
   ORDER BY vs.snapshot_date LIMIT 1) as week_1_views,
  (SELECT view_count FROM view_snapshots vs 
   WHERE vs.video_id = v.id AND vs.days_since_published <= 30 
   ORDER BY vs.snapshot_date LIMIT 1) as month_1_views,
  -- Growth rates
  CASE 
    WHEN v.published_at < NOW() - INTERVAL '7 days' THEN
      (v.view_count - COALESCE((SELECT view_count FROM view_snapshots vs 
       WHERE vs.video_id = v.id AND vs.days_since_published <= 7 
       ORDER BY vs.snapshot_date LIMIT 1), 0))::FLOAT / 
       NULLIF(EXTRACT(DAY FROM NOW() - v.published_at) - 7, 0)
    ELSE NULL
  END as daily_growth_after_week_1,
  -- Latest tracking info
  vtp.priority_tier,
  vtp.last_tracked,
  vtp.next_track_date
FROM videos v
LEFT JOIN view_tracking_priority vtp ON v.id = vtp.video_id
WHERE v.published_at IS NOT NULL;

CREATE INDEX idx_perf_trends_video ON video_performance_trends(video_id);
CREATE INDEX idx_perf_trends_channel ON video_performance_trends(channel_id);

-- 6. Function to update priorities for all videos
CREATE OR REPLACE FUNCTION update_all_tracking_priorities() RETURNS void AS $$
BEGIN
  INSERT INTO view_tracking_priority (video_id, priority_score, priority_tier, tracking_frequency_days, reason, updated_at)
  SELECT 
    v.id,
    cp.priority_score,
    cp.priority_tier,
    cp.tracking_frequency_days,
    cp.reason,
    NOW()
  FROM videos v
  CROSS JOIN LATERAL calculate_tracking_priority(
    v.id, 
    v.published_at, 
    v.view_count, 
    v.channel_avg_views, 
    v.performance_ratio
  ) cp
  WHERE v.published_at IS NOT NULL
  ON CONFLICT (video_id) DO UPDATE SET
    priority_score = EXCLUDED.priority_score,
    priority_tier = EXCLUDED.priority_tier,
    tracking_frequency_days = EXCLUDED.tracking_frequency_days,
    reason = EXCLUDED.reason,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- 7. Trigger to auto-update priority when video is updated
CREATE OR REPLACE FUNCTION update_video_tracking_priority() RETURNS TRIGGER AS $$
DECLARE
  v_priority_data RECORD;
BEGIN
  -- Calculate new priority
  SELECT * INTO v_priority_data
  FROM calculate_tracking_priority(
    NEW.id, 
    NEW.published_at, 
    NEW.view_count, 
    NEW.channel_avg_views, 
    NEW.performance_ratio
  );
  
  -- Update or insert priority
  INSERT INTO view_tracking_priority (
    video_id, priority_score, priority_tier, 
    tracking_frequency_days, reason, updated_at
  ) VALUES (
    NEW.id, v_priority_data.priority_score, v_priority_data.priority_tier,
    v_priority_data.tracking_frequency_days, v_priority_data.reason, NOW()
  )
  ON CONFLICT (video_id) DO UPDATE SET
    priority_score = EXCLUDED.priority_score,
    priority_tier = EXCLUDED.priority_tier,
    tracking_frequency_days = EXCLUDED.tracking_frequency_days,
    reason = EXCLUDED.reason,
    updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_video_tracking_priority
AFTER INSERT OR UPDATE OF view_count, performance_ratio, published_at ON videos
FOR EACH ROW
EXECUTE FUNCTION update_video_tracking_priority();