# Incremental Clustering System

This directory contains the incremental clustering system for handling daily updates of 100k+ videos. The system is designed to maintain cluster stability while efficiently processing new content and adapting to changes in the data distribution.

## Overview

The incremental clustering system consists of four main components:

1. **Incremental Assignment** - Assigns new videos to existing clusters
2. **Drift Detection** - Monitors cluster stability and detects when refresh is needed
3. **Partial Re-clustering** - Re-clusters specific regions that have drifted
4. **Evolution Tracking** - Tracks cluster changes over time

## Scripts

### 1. incremental-assignment.js
Assigns new videos to existing clusters using nearest centroid matching.

**Features:**
- Batch processing of unassigned videos (1000 per batch)
- Cosine similarity matching with configurable threshold (default: 0.65)
- Tracks unassigned videos for manual review
- Logs assignment statistics

**Usage:**
```bash
node incremental-assignment.js
```

### 2. cluster-drift-detection.js
Analyzes clusters for drift and generates recommendations.

**Drift Metrics:**
- Centroid shift (movement in embedding space)
- Low confidence ratio (videos with confidence < 0.7)
- Size change ratio (growth or shrinkage)
- Outlier ratio (videos far from centroid)
- Temporal drift (difference between old and new videos)

**Usage:**
```bash
node cluster-drift-detection.js
```

### 3. partial-reclustering.js
Re-clusters specific regions that have drifted significantly.

**Features:**
- Includes neighborhood videos within cosine distance radius
- Uses HDBSCAN for clustering
- Maps new clusters to existing ones based on overlap
- Creates new clusters only when necessary

**Usage:**
```bash
# Re-cluster specific clusters
node partial-reclustering.js 123 456 789

# Re-cluster based on drift detection results
node partial-reclustering.js
```

### 4. evolution-tracking.js
Tracks cluster evolution over time.

**Tracked Metrics:**
- Daily snapshots of cluster state
- Video transitions between clusters
- Growth/shrink rates
- Churn rates
- Stability scores
- Performance trends

**Usage:**
```bash
node evolution-tracking.js
```

### 5. daily-clustering-worker.js
Orchestrates all clustering tasks as part of daily workflow.

**Workflow Stages:**
1. Incremental assignment (if >= 1000 new videos)
2. Drift detection (every 7 days)
3. Partial re-clustering (if drift detected, max 5 clusters/day)
4. Evolution tracking (daily)

**Usage:**
```bash
# Run complete daily workflow
node daily-clustering-worker.js

# Or add to existing worker system
npm run worker:clustering
```

## Database Requirements

Run these SQL scripts before using the system:

```bash
# Create similarity search function
psql $DATABASE_URL < ../../sql/create-similarity-search-function.sql

# Create logging table
psql $DATABASE_URL < ../../sql/create-cluster-assignment-logs.sql

# Ensure BERTopic clusters table exists
psql $DATABASE_URL < ../../sql/create-bertopic-clusters-table-with-centroids.sql
```

## Configuration

### Environment Variables
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
DATABASE_URL=your_database_url
```

### Thresholds (in respective scripts)
- Assignment threshold: 0.65 (minimum cosine similarity)
- Drift thresholds:
  - Centroid shift: 0.15
  - Low confidence ratio: 0.3
  - Size change ratio: 2.0
  - Outlier ratio: 0.25
- Re-clustering:
  - Min cluster size: 30
  - Neighborhood radius: 0.2
  - Stability threshold: 0.8

## Output Files

The system generates various output files in `/outputs/clustering/`:

```
outputs/clustering/
├── incremental/
│   ├── assignment_log_YYYY-MM-DD.jsonl
│   ├── unassigned_YYYY-MM-DD.jsonl
│   └── reclustering_summary_YYYY-MM-DD.json
├── drift/
│   ├── drift_analysis_YYYY-MM-DD.json
│   ├── drifted_clusters_YYYY-MM-DD.json
│   └── drift_report_YYYY-MM-DD.md
├── evolution/
│   └── evolution_report_YYYY-MM-DD.json
└── workflow/
    └── workflow_YYYY-MM-DD.json
```

## Integration with Existing Workers

Add to your worker system by creating a new worker file:

```javascript
// clustering-worker.js
import { runDailyClusteringWorkflow } from './scripts/clustering/incremental/daily-clustering-worker.js';

// Run daily at 3 AM
schedule.scheduleJob('0 3 * * *', async () => {
  console.log('Starting daily clustering workflow...');
  await runDailyClusteringWorkflow();
});
```

Or add to package.json:
```json
{
  "scripts": {
    "worker:clustering": "node scripts/clustering/incremental/daily-clustering-worker.js"
  }
}
```

## Monitoring

Monitor the system through:

1. **Database queries:**
```sql
-- Recent workflow executions
SELECT * FROM cluster_assignment_logs 
WHERE log_type LIKE 'workflow_%'
ORDER BY created_at DESC 
LIMIT 10;

-- Assignment statistics
SELECT 
  date_trunc('day', created_at) as date,
  (stats->>'videos_assigned')::int as assigned,
  (stats->>'videos_unassigned')::int as unassigned,
  (stats->>'assignment_rate')::text as rate
FROM cluster_assignment_logs
WHERE log_type = 'incremental_assignment'
ORDER BY created_at DESC;

-- Evolution metrics
SELECT * FROM cluster_evolution_metrics
WHERE metric_date = CURRENT_DATE
ORDER BY growth_rate DESC;
```

2. **Output files** in `/outputs/clustering/`

3. **Drift reports** for actionable insights

## Troubleshooting

### Common Issues

1. **High number of unassigned videos**
   - Lower assignment threshold
   - Check if clusters are too specific
   - Consider full re-clustering

2. **Frequent drift detection**
   - Increase drift thresholds
   - Check for data distribution changes
   - Review cluster granularity

3. **Python script errors**
   - Ensure Python 3.x with required packages:
     ```bash
     pip install numpy scikit-learn hdbscan
     ```
   - Check file permissions

4. **Memory issues with large batches**
   - Reduce BATCH_SIZE in scripts
   - Process in smaller chunks
   - Increase Node.js memory: `node --max-old-space-size=4096`

## Best Practices

1. **Run order matters**: Assignment → Drift → Re-clustering → Evolution
2. **Monitor unassigned videos**: High numbers indicate need for new clusters
3. **Review drift reports**: Address high-priority clusters first
4. **Backup before re-clustering**: Large changes can affect many videos
5. **Test on subset first**: Use cluster IDs to test partial re-clustering

## Future Enhancements

- [ ] Real-time assignment API endpoint
- [ ] Automatic cluster naming with LLMs
- [ ] Hierarchical clustering support
- [ ] A/B testing for threshold optimization
- [ ] Cluster quality scoring
- [ ] Automated cluster merging/splitting