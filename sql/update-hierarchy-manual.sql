
-- Set extended timeout for this session
SET statement_timeout = '10min';

-- Update DIY & Crafts niches
UPDATE videos SET topic_niche = 'Woodworking' WHERE topic_cluster_id IN (0,15,51,64,124,153,173,178,185) AND bertopic_version = 'v1_2025-08-01';
UPDATE videos SET topic_niche = 'Metalworking' WHERE topic_cluster_id IN (57,167,170) AND bertopic_version = 'v1_2025-08-01';
UPDATE videos SET topic_niche = 'Workshop' WHERE topic_cluster_id IN (176,179,191,196,210,214) AND bertopic_version = 'v1_2025-08-01';

-- Update Technology niches
UPDATE videos SET topic_niche = 'Programming' WHERE topic_cluster_id IN (59,165,175,183) AND bertopic_version = 'v1_2025-08-01';
UPDATE videos SET topic_niche = 'Photography & Video' WHERE topic_cluster_id IN (12,41,114,143) AND bertopic_version = 'v1_2025-08-01';
UPDATE videos SET topic_niche = 'Electronics' WHERE topic_cluster_id IN (112,132,155,159) AND bertopic_version = 'v1_2025-08-01';
UPDATE videos SET topic_niche = '3D Printing' WHERE topic_cluster_id IN (22,97) AND bertopic_version = 'v1_2025-08-01';

-- Update Business niches  
UPDATE videos SET topic_niche = 'Digital Marketing' WHERE topic_cluster_id IN (9,14,34,201) AND bertopic_version = 'v1_2025-08-01';
UPDATE videos SET topic_niche = 'E-commerce' WHERE topic_cluster_id IN (42,68,158,193) AND bertopic_version = 'v1_2025-08-01';

-- Update Music niches
UPDATE videos SET topic_niche = 'Music Production' WHERE topic_cluster_id IN (29,79,83,89) AND bertopic_version = 'v1_2025-08-01';
UPDATE videos SET topic_niche = 'Instruments' WHERE topic_cluster_id IN (6,63,85,91,166) AND bertopic_version = 'v1_2025-08-01';

-- Update Gaming
UPDATE videos SET topic_niche = 'Gameplay' WHERE topic_cluster_id IN (18,20,93,99,109,111,135,163) AND bertopic_version = 'v1_2025-08-01';

-- Update Lifestyle niches
UPDATE videos SET topic_niche = 'Home & Organization' WHERE topic_cluster_id IN (2,36,117,160,169) AND bertopic_version = 'v1_2025-08-01';
UPDATE videos SET topic_niche = 'Alternative Living' WHERE topic_cluster_id IN (4,125,198) AND bertopic_version = 'v1_2025-08-01';

-- Update outliers
UPDATE videos SET topic_domain = 'Outlier', topic_niche = 'Outlier', topic_micro = 'Outlier' WHERE topic_cluster_id = -1 AND bertopic_version = 'v1_2025-08-01';

-- Show summary
SELECT topic_domain, topic_niche, COUNT(*) as video_count
FROM videos
WHERE bertopic_version = 'v1_2025-08-01'
GROUP BY topic_domain, topic_niche
ORDER BY topic_domain, topic_niche;
