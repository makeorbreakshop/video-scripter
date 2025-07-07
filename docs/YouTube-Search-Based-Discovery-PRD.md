# YouTube Search-Based Discovery Strategy PRD

## Executive Summary

This PRD outlines a systematic search-based channel discovery strategy designed to scale video collection to 1 million videos within the current 10,000 YouTube API units/day limit. The strategy prioritizes aggressive but sustainable discovery through strategic search queries, efficient quota allocation, and intelligent filtering.

## Problem Statement

**Current State:**
- 100+ channels imported through existing 6-method discovery system
- 10,000 YouTube API units/day quota limit
- Goal: Reach 1 million videos in database

**Challenge:**
- Current discovery rate too slow for 1M video goal
- Need systematic approach to find high-quality channels at scale
- Must operate within free API tier constraints

## Success Metrics

### Primary KPIs
- **Channels Imported**: 140-175 channels/week (target)
- **Videos Ingested**: 10,500-13,125 videos/week (target)
- **Quota Efficiency**: 95%+ daily quota utilization
- **Quality Rate**: 80%+ of discovered channels meet import criteria

### Timeline Targets
- **6 months**: 3,000-4,000 channels, 250K-300K videos
- **12 months**: 6,000-8,000 channels, 500K-600K videos
- **18 months**: 10,000+ channels, 750K-900K videos
- **24 months**: 13,000+ channels, 1M+ videos

## Strategy Overview

### Daily Quota Allocation (10,000 units)

```
Search Discovery: 2,000 units (20 searches × 100 units)
├── Morning Batch: 1,000 units (10 searches)
└── Evening Batch: 1,000 units (10 searches)

Channel Validation: 500 units
├── Batch Processing: 50 channels per call
└── Quality Filtering: Subscriber/activity checks

Video Import: 7,500 units (remaining quota)
├── Target: 20-25 channels/day
├── Average: 75-100 videos per channel
└── Daily Output: 1,500-2,500 videos
```

### Adaptive Search Strategy Matrix

#### Vector-Driven Search Term Generation

**Base Terms from Top Performers (40% - 8 searches):**
```sql
-- Daily extraction from high-performing videos
SELECT 
  extract_key_terms(title) as search_terms,
  performance_ratio,
  view_count
FROM videos 
WHERE performance_ratio > 2.0 
  AND published_at > NOW() - INTERVAL '30 days'
ORDER BY performance_ratio DESC 
LIMIT 20;

-- Generate variations: "workshop build" → "shop construction", "garage assembly"
```

**Semantic Variations (30% - 6 searches):**
```python
# Use existing vector embeddings to find related concepts
def expand_successful_patterns():
    successful_titles = get_top_performing_titles()
    
    for title in successful_titles:
        title_embedding = get_title_embedding(title)
        similar_concepts = vector_search(title_embedding, top_k=10)
        search_terms = extract_search_variations(similar_concepts)
    
    return prioritize_unused_terms(search_terms)
```

**Gap-Filling Terms (20% - 4 searches):**
```sql
-- Identify underrepresented clusters from existing analysis
SELECT 
  cluster_id,
  cluster_keywords,
  video_count,
  avg_performance
FROM clustering_analysis 
WHERE video_count < 50  -- Sparse clusters
ORDER BY avg_performance DESC;

-- Generate targeted searches to fill content gaps
```

**Experimental & Trending (10% - 2 searches):**
```python
# Analyze recent competitor uploads for emerging patterns
def discover_trending_terms():
    recent_competitors = get_recent_competitor_videos(days=7)
    trending_patterns = extract_emerging_keywords(recent_competitors)
    experimental_searches = generate_test_queries(trending_patterns)
    
    return experimental_searches
```

### Channel Quality Filters

#### Pre-Import Validation
- **Subscriber Range**: 1,000 - 500,000 (avoid too small/too large)
- **Video Count**: 10 - 1,000 videos (active but manageable)
- **Upload Frequency**: 1+ video per month (last 6 months)
- **Channel Activity**: Published within last 90 days

#### Relevance Scoring Algorithm
```javascript
relevanceScore = (
  titlePatternMatch * 0.4 +       // Match against successful patterns
  subscriberScore * 0.2 +         // Optimal subscriber range
  uploadConsistency * 0.2 +       // Regular upload schedule
  engagementRate * 0.1 +          // View-to-subscriber ratio
  nicheFocus * 0.1                // Content category consistency
)
```

#### Auto-Import Thresholds
- **Score > 4.0**: Auto-import without manual review
- **Score 3.0-4.0**: Queue for manual review
- **Score < 3.0**: Reject automatically

## Technical Implementation

### Search Execution Pipeline

#### Phase 1: Discovery (2,000 units)
```sql
-- Search execution schedule
Morning Batch (10 searches):
- 6 core niche searches
- 2 adjacent niche searches  
- 2 trending searches

Evening Batch (10 searches):
- 4 core niche searches
- 4 adjacent niche searches
- 2 seasonal/temporal searches
```

#### Phase 2: Validation (500 units)
```sql
-- Batch channel validation
FOR EACH batch_of_50_channels:
  channels_data = youtube.channels.list(
    part="statistics,snippet,brandingSettings",
    id=channel_ids_batch
  )
  
  filtered_channels = apply_quality_filters(channels_data)
  scored_channels = calculate_relevance_scores(filtered_channels)
```

#### Phase 3: Import (7,500 units)
```sql
-- Video import processing
FOR EACH approved_channel:
  video_list = youtube.playlistItems.list(
    part="snippet",
    playlistId=channel_uploads_playlist,
    maxResults=50  -- Import last 75-100 videos
  )
  
  process_video_batch(video_list)
```

### Database Schema Updates

#### Search Tracking Table
```sql
CREATE TABLE search_discovery (
  id SERIAL PRIMARY KEY,
  search_term VARCHAR(255),
  search_date DATE,
  results_count INTEGER,
  channels_discovered INTEGER,
  channels_imported INTEGER,
  quota_used INTEGER,
  success_rate DECIMAL(5,2)
);
```

#### Discovery Analytics
```sql
CREATE TABLE discovery_metrics (
  date DATE PRIMARY KEY,
  total_searches INTEGER,
  quota_used INTEGER,
  channels_discovered INTEGER,
  channels_imported INTEGER,
  videos_imported INTEGER,
  efficiency_score DECIMAL(5,2)
);
```

## Organic Search Term Evolution

### Vector-Based Term Discovery System

#### Daily Search Term Generation Algorithm
```python
def generate_daily_search_terms():
    """
    Generates 20 search terms daily based on vector analysis and performance data
    """
    
    # 1. Extract top performers (40% of searches)
    top_performers = analyze_recent_high_performers()
    base_terms = extract_semantic_keywords(top_performers)
    
    # 2. Generate semantic variations (30% of searches)  
    variations = []
    for term in base_terms:
        similar_embeddings = vector_similarity_search(term, threshold=0.8)
        variations.extend(generate_search_variations(similar_embeddings))
    
    # 3. Identify content gaps (20% of searches)
    sparse_clusters = identify_underrepresented_clusters()
    gap_terms = generate_gap_filling_searches(sparse_clusters)
    
    # 4. Experimental trending terms (10% of searches)
    trending = analyze_competitor_recent_uploads()
    experimental = generate_experimental_terms(trending)
    
    return optimize_search_mix(base_terms, variations, gap_terms, experimental)
```

#### Adaptive Performance Tracking
```sql
-- Enhanced search performance tracking
CREATE TABLE search_term_evolution (
  id SERIAL PRIMARY KEY,
  search_term VARCHAR(255),
  generation_method VARCHAR(50), -- 'top_performer', 'semantic', 'gap_fill', 'experimental'
  source_video_ids TEXT[],       -- Videos that inspired this term
  search_date DATE,
  channels_found INTEGER,
  channels_imported INTEGER,
  success_score DECIMAL(5,2),
  should_evolve BOOLEAN DEFAULT true
);

-- Track search term ancestry and evolution
CREATE TABLE search_term_lineage (
  parent_term VARCHAR(255),
  child_term VARCHAR(255),
  generation_date DATE,
  performance_improvement DECIMAL(5,2)
);
```

#### Weekly Evolution Cycle
```python
def weekly_search_evolution():
    """
    Weekly analysis and evolution of search strategy
    """
    
    # 1. Analyze last week's performance
    performance_data = analyze_weekly_search_performance()
    
    # 2. Promote successful terms to base rotation
    successful_terms = identify_high_performers(performance_data)
    promote_to_base_rotation(successful_terms)
    
    # 3. Retire poor performers
    poor_performers = identify_low_performers(performance_data)
    retire_search_terms(poor_performers)
    
    # 4. Generate evolutionary variations
    new_variations = generate_evolutionary_terms(successful_terms)
    
    # 5. Update vector similarity thresholds based on success patterns
    optimize_similarity_thresholds(performance_data)
    
    return generate_next_week_strategy()
```

### Content Gap Intelligence

#### Cluster-Based Discovery
```sql
-- Leverage existing clustering analysis for targeted discovery
WITH cluster_performance AS (
  SELECT 
    c.cluster_id,
    c.cluster_keywords,
    COUNT(v.id) as video_count,
    AVG(v.performance_ratio) as avg_performance,
    MAX(v.view_count) as peak_performance
  FROM clustering_analysis c
  LEFT JOIN videos v ON v.cluster_id = c.cluster_id
  GROUP BY c.cluster_id, c.cluster_keywords
),
underrepresented AS (
  SELECT * FROM cluster_performance
  WHERE video_count < 50 OR avg_performance > 1.5
)
SELECT 
  cluster_keywords,
  'Opportunity: ' || video_count || ' videos, ' || 
  ROUND(avg_performance, 2) || 'x performance' as reasoning
FROM underrepresented
ORDER BY avg_performance DESC;
```

#### Smart Gap Filling
```python
def generate_gap_filling_searches():
    """
    Generate searches to fill identified content gaps
    """
    sparse_clusters = get_sparse_high_performing_clusters()
    
    gap_searches = []
    for cluster in sparse_clusters:
        # Extract core concepts from cluster
        core_concepts = extract_cluster_concepts(cluster)
        
        # Generate search variations targeting this gap
        searches = generate_targeted_searches(core_concepts)
        gap_searches.extend(searches)
    
    return prioritize_gap_searches(gap_searches)
```

## Quality Assurance Framework

### Manual Review Process

#### Daily Review (20-30 channels)
- Review channels scoring 3.0-4.0
- Validate auto-import decisions (score >4.0)
- Flag false positives for algorithm improvement

#### Review Interface Requirements
- Channel preview with key metrics
- Sample recent video titles
- Subscriber growth chart
- Upload frequency visualization
- 1-click approve/reject buttons

### Feedback Loop Implementation

#### Algorithm Improvement
- Track post-import channel performance
- Adjust scoring weights based on success
- Update keyword strategies based on results
- Refine quality filters based on manual review feedback

## Risk Mitigation

### Quota Management
- **Daily Monitoring**: Track quota usage in real-time
- **Safety Margins**: Reserve 500 units for overages
- **Fallback Strategy**: Reduce searches if quota at 80%
- **Recovery Protocol**: Prioritize high-value operations if quota depleted

### Quality Control
- **Duplicate Detection**: Cross-reference with existing channels
- **Spam Filtering**: Detect auto-generated content channels
- **Relevance Validation**: Regular spot-checks of imported channels
- **Performance Monitoring**: Track engagement metrics post-import

### Compliance
- **Rate Limiting**: Respect YouTube's usage guidelines
- **API Best Practices**: Implement exponential backoff
- **Terms Adherence**: Ensure all usage complies with YouTube ToS
- **Error Handling**: Robust retry logic for failed requests

## Implementation Timeline

### Phase 1: Foundation (Week 1)
- [ ] Build search execution pipeline
- [ ] Implement channel validation logic
- [ ] Create scoring algorithm
- [ ] Set up tracking database tables

### Phase 2: Optimization (Week 2-3)
- [ ] Deploy search scheduling system
- [ ] Implement manual review interface
- [ ] Add performance monitoring
- [ ] Begin systematic search execution

### Phase 3: Scale (Week 4+)
- [ ] Full production deployment
- [ ] Weekly keyword optimization
- [ ] Monthly performance reviews
- [ ] Continuous algorithm improvements

## Success Validation

### Weekly Reviews
- Quota utilization rate
- Channel discovery efficiency
- Import success rate
- Video quality metrics

### Monthly Analysis
- Search term performance comparison
- Algorithm accuracy assessment
- Goal progress tracking
- Strategy refinement planning

### Quarterly Assessment
- Overall system performance
- Goal achievement analysis
- Resource allocation optimization
- Strategic pivot planning

## Resource Requirements

### Development Time
- **Initial Implementation**: 2-3 weeks
- **Optimization Phase**: 1-2 weeks
- **Ongoing Maintenance**: 2-4 hours/week

### Infrastructure
- **Database Updates**: New tracking tables
- **API Integration**: Search scheduling system
- **UI Components**: Manual review interface
- **Monitoring**: Real-time quota tracking

### Operational
- **Daily Review Time**: 30-45 minutes
- **Weekly Analysis**: 1-2 hours  
- **Monthly Optimization**: 2-3 hours
- **Quarterly Planning**: 4-6 hours

## Conclusion

This search-based discovery strategy provides a systematic approach to scaling video collection within API constraints. By optimizing search terms, implementing intelligent filtering, and maintaining quality controls, we can achieve 1M+ videos within 24 months while staying within the free YouTube API tier.

The strategy balances automation with human oversight, ensuring both scale and quality in our channel discovery process. Regular optimization and feedback loops will continuously improve performance and adapt to changing YouTube landscape.