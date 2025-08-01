# BERTopic Database Migration Plan

## Current State

### Existing Classification Fields in Videos Table:
```sql
-- Topic Classification (Hierarchical)
topic_domain TEXT           -- High-level category (e.g., "Technology")
topic_niche TEXT           -- Mid-level niche (e.g., "Programming")  
topic_micro TEXT           -- Specific topic (e.g., "Python Tutorials")
topic_cluster_id INTEGER   -- Numeric cluster ID
topic_confidence FLOAT     -- Confidence score (0-1)

-- Format Classification
format_type TEXT           -- One of 12 formats (tutorial, vlog, etc.)
format_confidence FLOAT    -- Confidence score
format_llm_used BOOLEAN   -- Which LLM was used

-- Metadata
classified_at TIMESTAMP    -- When classified
```

## Migration Strategy

### Phase 1: Add BERTopic Tracking (Immediate)
```sql
-- Add column to track BERTopic model version
ALTER TABLE videos ADD COLUMN bertopic_version TEXT;

-- This allows us to:
-- 1. Know which videos have new classifications
-- 2. Track model versions over time
-- 3. Enable A/B testing of different models
```

### Phase 2: Update Existing Fields (Current Approach)
We'll reuse the existing topic fields for BERTopic data:
- `topic_cluster_id` → BERTopic topic ID (0-215)
- `topic_domain` → Category from our naming (e.g., "DIY & Crafts")
- `topic_niche` → Subcategory (e.g., "Woodworking")
- `topic_micro` → Full topic name (e.g., "Woodworking Projects & Tool Reviews")
- `topic_confidence` → BERTopic confidence score
- `bertopic_version` → 'v1_2025-08-01'

### Phase 3: Future Schema Evolution
When ready for a cleaner schema:
```sql
-- New dedicated BERTopic table
CREATE TABLE video_topics (
    video_id TEXT REFERENCES videos(id),
    topic_id INTEGER NOT NULL,
    topic_name TEXT NOT NULL,
    category TEXT NOT NULL,
    subcategory TEXT NOT NULL,
    confidence FLOAT NOT NULL,
    model_version TEXT NOT NULL,
    assigned_at TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    PRIMARY KEY (video_id, model_version)
);

-- Allows multiple model versions per video
-- Enables A/B testing and gradual rollouts
```

## Implementation Steps

### 1. Run Database Update Script
```bash
python scripts/update-database-with-bertopic.py
```

This will:
- Load the trained BERTopic model
- Classify all 177K videos
- Update the database with new classifications

### 2. Create Database Views for Compatibility
```sql
-- View for topic distribution
CREATE OR REPLACE VIEW topic_distribution AS
SELECT 
    topic_cluster_id,
    topic_micro as topic_name,
    topic_domain as category,
    COUNT(*) as video_count,
    AVG(view_count) as avg_views,
    AVG(topic_confidence) as avg_confidence
FROM videos
WHERE bertopic_version IS NOT NULL
GROUP BY topic_cluster_id, topic_micro, topic_domain;

-- View for low confidence videos
CREATE OR REPLACE VIEW low_confidence_topics AS
SELECT id, title, channel_id, topic_micro, topic_confidence
FROM videos
WHERE topic_confidence < 0.3
AND bertopic_version IS NOT NULL;
```

### 3. Update Application Code
The existing code already uses these fields, so minimal changes needed:
- Add `bertopic_version` to queries where needed
- Update classification service to use BERTopic model for new videos
- Keep format classification separate (it's orthogonal to topics)

## Incremental Classification for New Videos

### Daily Process:
```python
# Pseudocode for daily classification
new_videos = get_videos_without_bertopic_classification()
embeddings = fetch_embeddings_from_pinecone(new_videos)
topics, confidences = bertopic_model.transform(embeddings)
update_database_with_classifications(new_videos, topics, confidences)
```

### Weekly Monitoring:
- Check topic distribution changes
- Monitor low-confidence classification rates
- Identify potential new topic clusters

### Quarterly Review:
- Analyze topic drift
- Consider selective retraining if needed
- Add new topics for emerging trends

## Benefits of This Approach

1. **No Breaking Changes**: Existing code continues to work
2. **Backward Compatible**: Old classifications preserved via version tracking
3. **Gradual Migration**: Can move to cleaner schema when ready
4. **A/B Testing Ready**: Can run multiple models in parallel
5. **Audit Trail**: Know exactly when and how videos were classified

## Rollback Plan

If issues arise:
```sql
-- Clear BERTopic classifications
UPDATE videos 
SET bertopic_version = NULL 
WHERE bertopic_version = 'v1_2025-08-01';

-- Revert to previous classifications if backed up
UPDATE videos
SET (topic_domain, topic_niche, topic_micro, topic_cluster_id) = 
    (backup.topic_domain, backup.topic_niche, backup.topic_micro, backup.topic_cluster_id)
FROM videos_backup backup
WHERE videos.id = backup.id;
```

## Next Steps

1. **Immediate**: Run the update script on a subset (1000 videos) to test
2. **Today**: If successful, run on all 177K videos
3. **This Week**: Update incremental classification pipeline
4. **Next Week**: Create topic dashboard and monitoring
5. **Future**: Plan cleaner schema migration if needed