-- YouTube API Quota Tracking System
-- Tracks daily quota usage to prevent hitting 10,000 unit limit

-- Create quota usage table
CREATE TABLE IF NOT EXISTS youtube_quota_usage (
  date DATE PRIMARY KEY,
  quota_used INTEGER DEFAULT 0,
  quota_limit INTEGER DEFAULT 10000,
  last_reset TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create quota calls log table for detailed tracking
CREATE TABLE IF NOT EXISTS youtube_quota_calls (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  method TEXT NOT NULL,
  cost INTEGER NOT NULL,
  description TEXT,
  job_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Function to increment quota usage
CREATE OR REPLACE FUNCTION increment_quota_usage(cost INTEGER)
RETURNS INTEGER AS $$
DECLARE
  today DATE;
  current_usage INTEGER;
BEGIN
  today := CURRENT_DATE;
  
  -- Insert or update today's usage
  INSERT INTO youtube_quota_usage (date, quota_used, last_reset)
  VALUES (today, cost, NOW())
  ON CONFLICT (date) 
  DO UPDATE SET 
    quota_used = youtube_quota_usage.quota_used + cost,
    updated_at = NOW();
  
  -- Get current usage
  SELECT quota_used INTO current_usage 
  FROM youtube_quota_usage 
  WHERE date = today;
  
  RETURN current_usage;
END;
$$ LANGUAGE plpgsql;

-- Function to log individual API calls
CREATE OR REPLACE FUNCTION log_youtube_api_call(
  method TEXT,
  cost INTEGER,
  description TEXT DEFAULT NULL,
  job_id TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO youtube_quota_calls (date, method, cost, description, job_id)
  VALUES (CURRENT_DATE, method, cost, description, job_id);
  
  -- Also increment the daily usage
  PERFORM increment_quota_usage(cost);
END;
$$ LANGUAGE plpgsql;

-- Function to get current quota status
CREATE OR REPLACE FUNCTION get_quota_status()
RETURNS JSON AS $$
DECLARE
  result JSON;
  today DATE;
BEGIN
  today := CURRENT_DATE;
  
  SELECT json_build_object(
    'date', today,
    'quota_used', COALESCE(quota_used, 0),
    'quota_limit', quota_limit,
    'quota_remaining', quota_limit - COALESCE(quota_used, 0),
    'percentage_used', ROUND((COALESCE(quota_used, 0)::DECIMAL / quota_limit::DECIMAL) * 100, 2)
  ) INTO result
  FROM youtube_quota_usage
  WHERE date = today;
  
  -- If no record exists for today, return default
  IF result IS NULL THEN
    result := json_build_object(
      'date', today,
      'quota_used', 0,
      'quota_limit', 10000,
      'quota_remaining', 10000,
      'percentage_used', 0
    );
  END IF;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to check if quota is available
CREATE OR REPLACE FUNCTION check_quota_available(estimated_cost INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  current_usage INTEGER;
  quota_limit INTEGER;
BEGIN
  SELECT 
    COALESCE(quota_used, 0),
    COALESCE(quota_limit, 10000)
  INTO current_usage, quota_limit
  FROM youtube_quota_usage
  WHERE date = CURRENT_DATE;
  
  -- If no record exists, assume 0 usage
  IF current_usage IS NULL THEN
    current_usage := 0;
    quota_limit := 10000;
  END IF;
  
  RETURN (current_usage + estimated_cost) <= quota_limit;
END;
$$ LANGUAGE plpgsql;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_youtube_quota_calls_date ON youtube_quota_calls(date);
CREATE INDEX IF NOT EXISTS idx_youtube_quota_calls_method ON youtube_quota_calls(method);
CREATE INDEX IF NOT EXISTS idx_youtube_quota_calls_job_id ON youtube_quota_calls(job_id);

-- Insert today's record if it doesn't exist
INSERT INTO youtube_quota_usage (date, quota_used, quota_limit)
VALUES (CURRENT_DATE, 0, 10000)
ON CONFLICT (date) DO NOTHING;

-- View for easy quota monitoring
CREATE OR REPLACE VIEW quota_daily_summary AS
SELECT 
  date,
  quota_used,
  quota_limit,
  quota_limit - quota_used as quota_remaining,
  ROUND((quota_used::DECIMAL / quota_limit::DECIMAL) * 100, 2) as percentage_used,
  last_reset
FROM youtube_quota_usage
ORDER BY date DESC;

-- View for API call breakdown
CREATE OR REPLACE VIEW quota_calls_summary AS
SELECT 
  date,
  method,
  COUNT(*) as call_count,
  SUM(cost) as total_cost,
  AVG(cost) as avg_cost
FROM youtube_quota_calls
GROUP BY date, method
ORDER BY date DESC, total_cost DESC;