-- Create Google PSE quota tracking table
CREATE TABLE IF NOT EXISTS google_pse_quota (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    searches_used INTEGER NOT NULL DEFAULT 0,
    max_daily_quota INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Create an index on date for fast lookups
CREATE INDEX IF NOT EXISTS idx_google_pse_quota_date ON google_pse_quota(date);

-- Create a function to increment quota
CREATE OR REPLACE FUNCTION increment_google_pse_quota()
RETURNS INTEGER AS $$
DECLARE
    current_date DATE := CURRENT_DATE;
    current_used INTEGER;
BEGIN
    -- Insert or update today's quota
    INSERT INTO google_pse_quota (date, searches_used)
    VALUES (current_date, 1)
    ON CONFLICT (date) 
    DO UPDATE SET 
        searches_used = google_pse_quota.searches_used + 1,
        updated_at = TIMEZONE('utc', NOW());
    
    -- Return the current usage
    SELECT searches_used INTO current_used
    FROM google_pse_quota
    WHERE date = current_date;
    
    RETURN current_used;
END;
$$ LANGUAGE plpgsql;

-- Create a function to get current quota status
CREATE OR REPLACE FUNCTION get_google_pse_quota_status()
RETURNS TABLE(
    used INTEGER,
    remaining INTEGER,
    total INTEGER
) AS $$
DECLARE
    current_date DATE := CURRENT_DATE;
    quota_used INTEGER;
    quota_max INTEGER;
BEGIN
    -- Get or create today's quota record
    INSERT INTO google_pse_quota (date, searches_used)
    VALUES (current_date, 0)
    ON CONFLICT (date) DO NOTHING;
    
    -- Get current values
    SELECT searches_used, max_daily_quota 
    INTO quota_used, quota_max
    FROM google_pse_quota
    WHERE date = current_date;
    
    RETURN QUERY SELECT 
        COALESCE(quota_used, 0) as used,
        COALESCE(quota_max - quota_used, 100) as remaining,
        COALESCE(quota_max, 100) as total;
END;
$$ LANGUAGE plpgsql;