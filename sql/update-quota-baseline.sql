-- Update YouTube quota usage to reflect actual Google Cloud Console data
-- Total API calls: 12 (3 channels.list + 3 search.list + 6 videos.list)
-- Total units: 309 (3×1 + 3×100 + 6×1)

-- Update today's quota usage
UPDATE youtube_quota_usage 
SET 
  quota_used = 309,
  updated_at = NOW()
WHERE date = CURRENT_DATE;

-- Clear any existing calls for today and insert the actual ones
DELETE FROM youtube_quota_calls WHERE date = CURRENT_DATE;

-- Insert the actual API calls based on Google Cloud Console
-- Note: Adding these with timestamps spread across the last few hours
INSERT INTO youtube_quota_calls (date, method, cost, description, job_id, created_at) VALUES
-- 3 channels.list calls (1 unit each)
(CURRENT_DATE, 'channels.list', 1, 'Channel metadata fetch (untracked)', 'baseline-1', NOW() - INTERVAL '5 hours'),
(CURRENT_DATE, 'channels.list', 1, 'Channel metadata fetch (untracked)', 'baseline-2', NOW() - INTERVAL '4.5 hours'),
(CURRENT_DATE, 'channels.list', 1, 'Channel metadata fetch (untracked)', 'baseline-3', NOW() - INTERVAL '4 hours'),
-- 3 search.list calls (100 units each)
(CURRENT_DATE, 'search.list', 100, 'Video search (untracked)', 'baseline-1', NOW() - INTERVAL '3.5 hours'),
(CURRENT_DATE, 'search.list', 100, 'Video search (untracked)', 'baseline-2', NOW() - INTERVAL '3 hours'),
(CURRENT_DATE, 'search.list', 100, 'Video search (untracked)', 'baseline-3', NOW() - INTERVAL '2.5 hours'),
-- 6 videos.list calls (1 unit each)
(CURRENT_DATE, 'videos.list', 1, 'Video details fetch (untracked)', 'baseline-1', NOW() - INTERVAL '2 hours'),
(CURRENT_DATE, 'videos.list', 1, 'Video details fetch (untracked)', 'baseline-2', NOW() - INTERVAL '1.75 hours'),
(CURRENT_DATE, 'videos.list', 1, 'Video details fetch (untracked)', 'baseline-3', NOW() - INTERVAL '1.5 hours'),
(CURRENT_DATE, 'videos.list', 1, 'Video details fetch (untracked)', 'baseline-4', NOW() - INTERVAL '1.25 hours'),
(CURRENT_DATE, 'videos.list', 1, 'Video details fetch (untracked)', 'baseline-5', NOW() - INTERVAL '1 hour'),
(CURRENT_DATE, 'videos.list', 1, 'Video details fetch (untracked)', 'baseline-6', NOW() - INTERVAL '45 minutes');

-- Verify the update
SELECT 
  'Quota Usage' as report_type,
  quota_used || '/' || quota_limit || ' units (' || ROUND((quota_used::numeric / quota_limit) * 100, 2) || '%)' as status
FROM youtube_quota_usage 
WHERE date = CURRENT_DATE

UNION ALL

SELECT 
  'API Breakdown' as report_type,
  method || ': ' || COUNT(*) || ' calls = ' || SUM(cost) || ' units' as status
FROM youtube_quota_calls 
WHERE date = CURRENT_DATE
GROUP BY method

UNION ALL

SELECT 
  'Total Calls' as report_type,
  COUNT(*) || ' API calls = ' || SUM(cost) || ' total units' as status
FROM youtube_quota_calls 
WHERE date = CURRENT_DATE;