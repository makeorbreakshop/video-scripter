-- Views to help analyze topics for potential splitting or merging

-- 1. Topics that might need splitting (too many videos)
DROP VIEW IF EXISTS topics_needing_split CASCADE;
CREATE VIEW topics_needing_split AS
WITH stats AS (
  SELECT 
    topic_cluster_id,
    domain,
    niche,
    micro_topic,
    video_count,
    micro_topic_percentage,
    overall_rank,
    -- Calculate if this topic is an outlier in size
    AVG(video_count) OVER () as avg_videos_per_topic,
    STDDEV(video_count) OVER () as stddev_videos
  FROM topic_distribution_stats
  WHERE topic_cluster_id >= 0  -- Exclude outliers
)
SELECT 
  topic_cluster_id,
  domain,
  niche,
  micro_topic,
  video_count,
  micro_topic_percentage,
  overall_rank,
  ROUND((video_count - avg_videos_per_topic) / NULLIF(stddev_videos, 0), 2) as z_score,
  CASE 
    WHEN video_count > avg_videos_per_topic + (2 * stddev_videos) THEN 'High Priority'
    WHEN video_count > avg_videos_per_topic + stddev_videos THEN 'Medium Priority'
    ELSE 'Monitor'
  END as split_priority
FROM stats
WHERE video_count > avg_videos_per_topic + stddev_videos  -- More than 1 std dev above mean
ORDER BY video_count DESC;

-- 2. Topics that might need merging (too few videos)
DROP VIEW IF EXISTS topics_needing_merge CASCADE;
CREATE VIEW topics_needing_merge AS
WITH stats AS (
  SELECT 
    topic_cluster_id,
    domain,
    niche,
    micro_topic,
    video_count,
    micro_topic_percentage,
    AVG(video_count) OVER () as avg_videos_per_topic,
    -- Find similar topics in same niche
    COUNT(*) OVER (PARTITION BY domain, niche) as topics_in_niche,
    SUM(video_count) OVER (PARTITION BY domain, niche) as videos_in_niche
  FROM topic_distribution_stats
  WHERE topic_cluster_id >= 0
)
SELECT 
  topic_cluster_id,
  domain,
  niche,
  micro_topic,
  video_count,
  micro_topic_percentage,
  topics_in_niche,
  videos_in_niche,
  CASE 
    WHEN video_count < 100 AND micro_topic_percentage < 0.1 THEN 'High Priority'
    WHEN video_count < 200 AND micro_topic_percentage < 0.2 THEN 'Medium Priority'
    ELSE 'Monitor'
  END as merge_priority
FROM stats
WHERE video_count < avg_videos_per_topic / 2  -- Less than half the average
ORDER BY video_count ASC;

-- 3. Outlier analysis
DROP VIEW IF EXISTS outlier_topic_analysis CASCADE;
CREATE VIEW outlier_topic_analysis AS
WITH outlier_stats AS (
  SELECT 
    v.id,
    v.title,
    v.channel_title,
    v.topic_confidence,
    v.created_at,
    -- Get title embedding status
    CASE WHEN v.pinecone_embedded THEN 'Yes' ELSE 'No' END as has_title_embedding,
    CASE WHEN v.llm_summary_embedding_synced THEN 'Yes' ELSE 'No' END as has_summary_embedding
  FROM videos v
  WHERE v.topic_cluster_id = -1
    AND v.bertopic_version = 'v1_2025-08-01'
)
SELECT 
  COUNT(*) as total_outliers,
  ROUND(AVG(topic_confidence::numeric), 3) as avg_confidence,
  COUNT(CASE WHEN has_title_embedding = 'Yes' THEN 1 END) as with_title_embedding,
  COUNT(CASE WHEN has_summary_embedding = 'Yes' THEN 1 END) as with_summary_embedding,
  COUNT(CASE WHEN has_title_embedding = 'Yes' AND has_summary_embedding = 'Yes' THEN 1 END) as with_both_embeddings,
  MIN(created_at)::date as earliest_outlier,
  MAX(created_at)::date as latest_outlier
FROM outlier_stats;

-- 4. Topic balance score (how evenly distributed are videos across topics)
DROP VIEW IF EXISTS topic_balance_metrics CASCADE;
CREATE VIEW topic_balance_metrics AS
WITH metrics AS (
  SELECT 
    COUNT(DISTINCT topic_cluster_id) as total_topics,
    COUNT(*) as total_videos,
    AVG(video_count) as avg_videos_per_topic,
    STDDEV(video_count) as stddev_videos,
    MIN(video_count) as min_videos,
    MAX(video_count) as max_videos,
    -- Gini coefficient for inequality measurement (0 = perfect equality, 1 = perfect inequality)
    (SUM(
      (2 * ROW_NUMBER() OVER (ORDER BY video_count) - COUNT(*) OVER () - 1) * video_count
    )::numeric / 
    (COUNT(*) OVER () * SUM(video_count) OVER ())) as gini_coefficient
  FROM topic_distribution_stats
  WHERE topic_cluster_id >= 0
)
SELECT 
  total_topics,
  total_videos,
  ROUND(avg_videos_per_topic, 1) as avg_videos_per_topic,
  ROUND(stddev_videos, 1) as stddev_videos,
  min_videos,
  max_videos,
  ROUND(max_videos::numeric / NULLIF(min_videos, 0), 1) as max_min_ratio,
  ROUND(stddev_videos::numeric / NULLIF(avg_videos_per_topic, 0), 3) as coefficient_of_variation,
  ROUND(gini_coefficient, 3) as gini_coefficient,
  CASE 
    WHEN gini_coefficient < 0.3 THEN 'Well Balanced'
    WHEN gini_coefficient < 0.5 THEN 'Moderately Balanced'
    WHEN gini_coefficient < 0.7 THEN 'Imbalanced'
    ELSE 'Severely Imbalanced'
  END as balance_assessment
FROM metrics;

-- Grant permissions
GRANT SELECT ON topics_needing_split TO authenticated;
GRANT SELECT ON topics_needing_merge TO authenticated;
GRANT SELECT ON outlier_topic_analysis TO authenticated;
GRANT SELECT ON topic_balance_metrics TO authenticated;
GRANT SELECT ON topics_needing_split TO anon;
GRANT SELECT ON topics_needing_merge TO anon;
GRANT SELECT ON outlier_topic_analysis TO anon;
GRANT SELECT ON topic_balance_metrics TO anon;

-- Add helpful comments
COMMENT ON VIEW topics_needing_split IS 'Topics with significantly more videos than average that might benefit from splitting into subtopics';
COMMENT ON VIEW topics_needing_merge IS 'Topics with very few videos that might benefit from merging with related topics';
COMMENT ON VIEW outlier_topic_analysis IS 'Analysis of videos classified as outliers (topic_cluster_id = -1)';
COMMENT ON VIEW topic_balance_metrics IS 'Overall metrics showing how evenly videos are distributed across topics';