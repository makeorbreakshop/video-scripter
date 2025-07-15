-- Fix confidence scoring data population
-- This populates age_confidence scores for all videos

-- First, let's check current state
SELECT 
    COUNT(*) as total_videos,
    COUNT(age_confidence) as videos_with_confidence,
    ROUND(COUNT(age_confidence)::numeric / COUNT(*) * 100, 2) as confidence_percentage
FROM videos;

-- Update all videos with age confidence scores
UPDATE videos 
SET age_confidence = LEAST(
    EXTRACT(EPOCH FROM (NOW() - published_at)) / (86400 * 30), 
    1.0
)
WHERE age_confidence IS NULL;

-- Verify the update worked
SELECT 
    COUNT(*) as total_videos,
    COUNT(age_confidence) as videos_with_confidence,
    ROUND(AVG(age_confidence), 3) as avg_confidence,
    ROUND(MIN(age_confidence), 3) as min_confidence,
    ROUND(MAX(age_confidence), 3) as max_confidence
FROM videos;

-- Check distribution by confidence ranges
SELECT 
    CASE 
        WHEN age_confidence < 0.3 THEN 'Low (0-30%)'
        WHEN age_confidence < 0.7 THEN 'Medium (30-70%)'
        ELSE 'High (70-100%)'
    END as confidence_range,
    COUNT(*) as video_count,
    ROUND(COUNT(*)::numeric / (SELECT COUNT(*) FROM videos) * 100, 2) as percentage
FROM videos
WHERE age_confidence IS NOT NULL
GROUP BY 
    CASE 
        WHEN age_confidence < 0.3 THEN 'Low (0-30%)'
        WHEN age_confidence < 0.7 THEN 'Medium (30-70%)'
        ELSE 'High (70-100%)'
    END
ORDER BY confidence_range;