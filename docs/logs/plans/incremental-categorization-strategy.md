# Incremental Categorization Strategy

## Current Problem
- Full BERTopic recalculation takes hours
- Downloads 700+ MB of embeddings each time
- Gets worse as dataset grows
- Can't easily add new videos without disrupting existing categories

## Proposed Solution: Hybrid Incremental System

### 1. **Stable Core Topics (Quarterly Updates)**
```python
# Run full BERTopic only quarterly on representative sample
# Save the topic model and topic definitions
topic_model.save("stable_topic_model_2025_q1")

# Extract topic centroids (representative embeddings)
topic_centroids = {}
for topic_id in topic_ids:
    # Get embeddings of videos in this topic
    topic_embeddings = embeddings[topics == topic_id]
    # Calculate centroid
    topic_centroids[topic_id] = np.mean(topic_embeddings, axis=0)
```

### 2. **Daily Incremental Classification**
```python
# For new videos, classify against existing topics
def classify_new_videos(new_video_embeddings, topic_centroids):
    classifications = []
    for embedding in new_video_embeddings:
        # Find nearest topic centroid
        distances = {}
        for topic_id, centroid in topic_centroids.items():
            dist = cosine_distance(embedding, centroid)
            distances[topic_id] = dist
        
        # Assign to nearest topic
        best_topic = min(distances, key=distances.get)
        confidence = 1 - distances[best_topic]
        classifications.append({
            'topic': best_topic,
            'confidence': confidence
        })
    return classifications
```

### 3. **Smart Retraining Triggers**
Monitor when full retraining is needed:
- Outlier rate > 20% (many videos don't fit existing topics)
- New content domain detected
- Significant drift in topic distributions
- Quarterly schedule regardless

### 4. **Implementation Architecture**

```sql
-- Add columns to videos table
ALTER TABLE videos ADD COLUMN classification_method TEXT;
ALTER TABLE videos ADD COLUMN classification_version TEXT;
ALTER TABLE videos ADD COLUMN needs_reclassification BOOLEAN DEFAULT false;

-- Topic definitions table
CREATE TABLE topic_definitions (
    topic_id INTEGER PRIMARY KEY,
    topic_level INTEGER,
    centroid_embedding vector(512),
    keywords TEXT[],
    example_video_ids TEXT[],
    created_at TIMESTAMP,
    version TEXT
);

-- Classification log for monitoring drift
CREATE TABLE classification_log (
    id SERIAL PRIMARY KEY,
    video_id TEXT,
    assigned_topic INTEGER,
    confidence FLOAT,
    outlier BOOLEAN,
    classified_at TIMESTAMP
);
```

### 5. **Workflow Implementation**

#### A. Initial Setup (One Time)
1. Run full BERTopic on all videos
2. Save topic model and extract centroids
3. Store topic definitions in database
4. Mark all videos as "batch_classified"

#### B. Daily Incremental (Automated)
```python
# 1. Fetch new videos
new_videos = supabase.table('videos') \
    .select('id, title') \
    .is_('topic_cluster_id', None) \
    .limit(1000) \
    .execute()

# 2. Get their embeddings from Pinecone
embeddings = fetch_from_pinecone(video_ids)

# 3. Classify against existing topics
classifications = classify_against_centroids(embeddings)

# 4. Update database
for video_id, classification in classifications:
    if classification['confidence'] > 0.7:
        # High confidence - assign directly
        update_video_topic(video_id, classification)
    else:
        # Low confidence - mark for review
        mark_for_reclassification(video_id)
```

#### C. Weekly Monitoring
```python
# Check health metrics
outlier_rate = check_outlier_rate()
drift_score = calculate_topic_drift()
new_domain_signals = detect_new_content_domains()

if should_trigger_retraining(outlier_rate, drift_score, new_domain_signals):
    schedule_full_retraining()
```

### 6. **Optimization Strategies**

#### A. Representative Sampling
```python
# Don't retrain on ALL videos - use smart sampling
def get_representative_sample(all_videos, sample_size=50000):
    # Include:
    # - All videos from last quarter (recent trends)
    # - High-view videos (important content)
    # - Random sample from each existing topic
    # - All current outliers
    return balanced_sample
```

#### B. Incremental Topic Model Updates
```python
# Use River or sklearn's MiniBatchKMeans for online learning
from river import cluster

# Initialize with existing topics
online_model = cluster.KMeans(n_clusters=k, seed=42)

# Update with new data batches
for batch in new_video_batches:
    online_model.learn_many(batch)
```

#### C. Caching Strategy
```sql
-- Materialized view for topic centroids
CREATE MATERIALIZED VIEW topic_centroids AS
SELECT 
    topic_cluster_id,
    topic_level,
    AVG(embedding) as centroid_embedding,
    COUNT(*) as video_count,
    AVG(topic_confidence) as avg_confidence
FROM videos v
JOIN embeddings e ON v.id = e.video_id
WHERE topic_confidence > 0.7
GROUP BY topic_cluster_id, topic_level;

-- Refresh weekly
REFRESH MATERIALIZED VIEW topic_centroids;
```

### 7. **Practical Daily Workflow**

```javascript
// workers/incremental-topic-classifier.js
async function runIncrementalClassification() {
    // 1. Get unclassified videos (last 24h)
    const newVideos = await getUnclassifiedVideos(limit=1000);
    
    // 2. Check if we have their embeddings
    const videosWithEmbeddings = await filterVideosWithEmbeddings(newVideos);
    
    // 3. Load topic centroids from cache
    const topicCentroids = await loadTopicCentroids();
    
    // 4. Classify in batches
    for (const batch of chunks(videosWithEmbeddings, 100)) {
        const embeddings = await fetchEmbeddings(batch);
        const classifications = await classifyBatch(embeddings, topicCentroids);
        await updateDatabase(classifications);
    }
    
    // 5. Check if retraining needed
    const metrics = await calculateMetrics();
    if (metrics.outlierRate > 0.2 || metrics.daysSinceLastTraining > 90) {
        await scheduleFullRetraining();
    }
}
```

### 8. **Migration Path**

1. **Phase 1**: Run current full BERTopic, save model
2. **Phase 2**: Implement incremental classifier
3. **Phase 3**: Run both in parallel, compare results
4. **Phase 4**: Switch to incremental as primary
5. **Phase 5**: Full retraining only quarterly

### 9. **Monitoring Dashboard**

Track key metrics:
- Daily videos classified
- Confidence distribution
- Outlier rate trend
- Topic distribution changes
- Time since last full training
- Classification speed (videos/minute)

This approach scales much better:
- Daily: Process only ~500-1000 new videos (2-4 MB)
- Weekly: Update statistics and monitor drift
- Quarterly: Full retrain on representative sample
- Emergency: Triggered retraining if major drift detected