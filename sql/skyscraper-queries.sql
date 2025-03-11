-- Sample queries for working with the skyscraper_analyses table

-- 1. Get all analyses for a specific video
SELECT * FROM public.skyscraper_analyses
WHERE video_id = 'your_video_id'
ORDER BY analysis_date DESC;

-- 2. Get the most recent analysis for a specific video
SELECT * FROM public.skyscraper_analyses
WHERE video_id = 'your_video_id'
ORDER BY analysis_date DESC
LIMIT 1;

-- 3. Get all analyses for a specific user
SELECT sa.*, v.title as video_title
FROM public.skyscraper_analyses sa
JOIN public.videos v ON sa.video_id = v.id
WHERE sa.user_id = 'your_user_id'
ORDER BY sa.analysis_date DESC;

-- 4. Get specific analysis components for a video
SELECT 
  id,
  video_id,
  content_analysis->'structural_organization' as structure,
  audience_analysis->'sentiment_overview' as sentiment,
  framework_elements->'section_ratios' as section_ratios
FROM public.skyscraper_analyses
WHERE video_id = 'your_video_id'
ORDER BY analysis_date DESC
LIMIT 1;

-- 5. Search for analyses with specific content
SELECT id, video_id, analysis_date
FROM public.skyscraper_analyses
WHERE 
  content_analysis->'key_points' @> '[{"point": "Your search term"}]'::jsonb
  OR audience_analysis->'sentiment_overview'->'key_themes' ? 'Your theme'
ORDER BY analysis_date DESC;

-- 6. Update a specific analysis
UPDATE public.skyscraper_analyses
SET 
  content_analysis = jsonb_set(
    content_analysis, 
    '{key_points}', 
    (content_analysis->'key_points') || '[{"point": "New key point", "timestamp": "10:30", "elaboration": "Details about this point"}]'::jsonb
  )
WHERE id = 'your_analysis_id';

-- 7. Delete an analysis
DELETE FROM public.skyscraper_analyses
WHERE id = 'your_analysis_id';

-- 8. Count analyses by model used
SELECT 
  model_used, 
  COUNT(*) as analysis_count
FROM public.skyscraper_analyses
GROUP BY model_used
ORDER BY analysis_count DESC;

-- 9. Get average sentiment by video
SELECT 
  v.title,
  v.id as video_id,
  AVG((sa.audience_analysis->'sentiment_overview'->>'positive')::float) as avg_positive,
  AVG((sa.audience_analysis->'sentiment_overview'->>'negative')::float) as avg_negative
FROM public.skyscraper_analyses sa
JOIN public.videos v ON sa.video_id = v.id
GROUP BY v.id, v.title
ORDER BY avg_positive DESC;

-- 10. Find analyses with specific engagement techniques
SELECT 
  sa.id,
  v.title,
  sa.engagement_techniques->'hook_strategy' as hook_strategy
FROM public.skyscraper_analyses sa
JOIN public.videos v ON sa.video_id = v.id
WHERE 
  sa.engagement_techniques->'retention_mechanisms' @> '[{"technique": "Your technique"}]'::jsonb
ORDER BY sa.analysis_date DESC; 