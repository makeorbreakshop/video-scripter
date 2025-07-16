# Pattern Discovery Data Flow

## System Data Flow Diagram

```
┌─────────────────────────────── INGESTION LAYER ─────────────────────────────┐
│                                                                              │
│  New Video → YouTube API → Video Metadata → PostgreSQL                      │
│                   ↓                                                          │
│            Transcript API → Chunks → Text Processing                        │
│                                          ↓                                   │
│                                    OpenAI Embeddings → Pinecone             │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                          ↓
┌─────────────────────────── PATTERN DISCOVERY LAYER ─────────────────────────┐
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Semantic Pattern Discovery                        │   │
│  │                                                                       │   │
│  │  1. Find High Performers  →  2. Query Similar Videos (Pinecone)     │   │
│  │           ↓                            ↓                             │   │
│  │  3. Build Semantic Clusters  →  4. Analyze Patterns                 │   │
│  │           ↓                            ↓                             │   │
│  │  5. Statistical Mining     →  6. LLM Validation                     │   │
│  │           ↓                            ↓                             │   │
│  │  7. Store Patterns (PostgreSQL) → 8. Index by Embedding             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                          ↓
┌───────────────────────────── MATCHING LAYER ────────────────────────────────┐
│                                                                              │
│  New Video → Get Embedding → Query Pattern Centroids → Calculate Similarity │
│      ↓             ↓                    ↓                      ↓            │
│  Redis Cache ← Pattern Matches ← Score & Filter ← Within Semantic Radius?   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                          ↓
┌─────────────────────────────── API LAYER ───────────────────────────────────┐
│                                                                              │
│  Pattern Discovery API ←→ Pattern Matching API ←→ Recommendation API        │
│         ↑                        ↑                         ↑                 │
│    Batch Process           Real-time Match          Personalized Insights    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Detailed Process Flows

### 1. Video Ingestion Flow
```
YouTube Video ID
    ↓
Fetch Metadata (YouTube API)
    ↓
Store in PostgreSQL (videos table)
    ↓
Generate Title Embedding (OpenAI)
    ↓
Store in Pinecone with metadata
    ↓
Update video.pinecone_embedded = true
```

### 2. Semantic Cluster Discovery Flow
```
Query High Performers (performance_ratio > 2.0, age > 30 days)
    ↓
For Each High Performer:
    ↓
    Fetch Embedding from Pinecone
    ↓
    Find Similar Videos (cosine similarity > 0.8)
    ↓
    If cluster_size >= 30:
        ↓
        Calculate Centroid Embedding
        ↓
        Create Semantic Cluster
        ↓
        Mark Videos as Processed
```

### 3. Pattern Analysis Flow
```
For Each Semantic Cluster:
    ↓
    Get Cluster Videos from PostgreSQL
    ↓
    Calculate Performance Metrics
    ↓
    Run Pattern Analyzers:
        - Format Distribution
        - Title N-grams
        - Duration Buckets
        - Combined Features
    ↓
    For Each Pattern Candidate:
        ↓
        Calculate Lift Ratio
        ↓
        If lift > 1.5 and sample_size >= 5:
            ↓
            Validate with LLM
            ↓
            Store Pattern with Centroid
```

### 4. Real-time Matching Flow
```
New Video Request
    ↓
Check Redis Cache
    ↓
If cache miss:
    ↓
    Get Video Embedding from Pinecone
    ↓
    Query All Pattern Centroids
    ↓
    Calculate Cosine Similarities
    ↓
    Filter by Semantic Radius
    ↓
    Score and Rank Matches
    ↓
    Cache Results (TTL: 1 hour)
    ↓
Return Pattern Matches
```

### 5. Incremental Update Flow
```
Every Hour:
    ↓
    Get Videos from Last Hour
    ↓
    For Each New Video:
        ↓
        Find Nearest Clusters
        ↓
        Update Cluster Stats
        ↓
        Check Pattern Matches
        ↓
        Update Pattern Performance
    ↓
    If Cluster Size Changed > 10%:
        ↓
        Schedule Rebalancing
    ↓
    Refresh Materialized Views
```

## Data Storage Locations

### PostgreSQL
- **videos**: Video metadata, performance metrics
- **patterns**: Discovered patterns with centroids
- **video_patterns**: Video-pattern associations
- **pattern_discovery_metrics**: Performance tracking

### Pinecone
- **video-titles-512d**: Title embeddings with metadata
- **video-thumbnails-768d**: Thumbnail embeddings (future)

### Redis Cache
- **pattern_match:{video_id}**: Cached pattern matches
- **cluster_membership:{video_id}**: Video cluster assignments
- **pattern_query:{hash}**: Cached query results
- **embedding:{video_id}**: Cached embeddings

## Performance Optimization Points

### 1. Batch Operations
- Fetch embeddings in batches of 100
- Process patterns in parallel
- Bulk insert pattern matches

### 2. Caching Strategy
- L1: Redis (hot data, <1ms)
- L2: Materialized views (<10ms)
- L3: Pinecone metadata (<50ms)

### 3. Query Optimization
- Use covering indexes
- Limit result sets early
- Precompute expensive aggregations

### 4. Scaling Triggers
- When clusters > 1000: Add Pinecone pods
- When patterns > 10K: Partition pattern table
- When QPS > 1000: Add read replicas

## Monitoring Points

### Key Metrics
1. **Pattern Discovery**
   - Patterns found per run
   - Processing time per cluster
   - LLM validation success rate

2. **Pattern Matching**
   - Match response time (p50, p95, p99)
   - Cache hit rate
   - Patterns per video

3. **System Health**
   - Pinecone query latency
   - PostgreSQL connection pool
   - Redis memory usage
   - Worker queue depth

### Alerts
- Pattern discovery failure
- Match response time > 500ms
- Cache hit rate < 70%
- Cluster imbalance > 50%