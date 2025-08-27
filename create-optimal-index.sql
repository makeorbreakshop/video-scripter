-- Create the optimal composite index for the random video selection
-- This index covers all the WHERE conditions AND the ORDER BY

-- Drop the old index if it exists
DROP INDEX IF EXISTS idx_videos_random_sort;

-- Create a composite index that includes all filter columns
CREATE INDEX CONCURRENTLY idx_videos_random_filter 
ON videos (
  random_sort,
  temporal_performance_score,
  view_count,
  published_at DESC
) 
WHERE 
  is_short = false 
  AND is_institutional = false
  AND temporal_performance_score >= 1
  AND temporal_performance_score <= 100;

-- This index will allow PostgreSQL to:
-- 1. Quickly filter by random_sort >= threshold
-- 2. Apply other filters without fetching rows
-- 3. Return results already sorted by random_sort
-- 4. Use index-only scan when possible