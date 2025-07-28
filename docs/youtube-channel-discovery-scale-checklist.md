# YouTube Channel Discovery Scale Implementation Checklist

## Goal: Reach 1M+ Videos via Aggressive Channel Discovery

### Current Status
- [x] Current videos: 171,752
- [x] Videos needed: 828,248
- [x] Current channels: ~2,000
- [x] Available YouTube API quota: ~9,000 units/day
- [x] Existing discovery system: Already built with tables and endpoints!

### Phase 1: Enhance Existing Discovery System (Week 1) ✅ COMPLETED

#### Leverage Existing Infrastructure
- [x] Discovery tables already exist: `channel_discovery`, `discovered_channels`
- [x] Search endpoint exists: `/api/youtube/discovery/search`
- [x] Video-first search already implemented
- [x] Channel validation and filtering in place

#### Google Programmable Search Engine ✅ REQUIRED SETUP
- [ ] **Create Google Cloud Project**
  1. Go to https://console.cloud.google.com
  2. Create new project or select existing
  3. Enable "Custom Search API"
  
- [ ] **Create Programmable Search Engine**
  1. Go to https://programmablesearchengine.google.com
  2. Click "Add" to create new search engine
  3. In "Sites to search" add: `*.youtube.com/*`
  4. Name your search engine
  5. Click "Create"
  6. Copy your Search Engine ID (cx parameter)
  
- [ ] **Get API Key**
  1. Go to https://console.cloud.google.com/apis/credentials
  2. Create API key
  3. Restrict to "Custom Search API"
  
- [ ] **Add to Environment Variables**
  ```bash
  GOOGLE_PSE_API_KEY=your_api_key_here
  GOOGLE_PSE_ENGINE_ID=your_search_engine_id_here
  ```
  
- [ ] **Benefits**
  - 100 FREE searches per day (vs 100 YouTube API units per search)
  - Saves 10,000 YouTube API units daily!
  - Searches return YouTube video/channel URLs
  - Extract multiple channels per search

#### Enhance Existing Tables ✅ COMPLETED
- [x] Added discovery tracking columns to discovered_channels
- [x] Created discovery_search_queries table
- [x] Created discovery_runs table
- [x] Created discovery_performance view
- [x] Added performance indexes
  ```sql
  -- Add to existing discovered_channels table
  ALTER TABLE discovered_channels ADD COLUMN IF NOT EXISTS
    priority_score NUMERIC(3,2),
    import_priority INT DEFAULT 5,
    estimated_quality_videos INT,
    topic_alignment_score NUMERIC(3,2),
    search_query TEXT,
    search_type TEXT; -- 'youtube_api', 'google_pse', 'hybrid'

  -- Track search performance
  CREATE TABLE IF NOT EXISTS discovery_search_queries (
    id SERIAL PRIMARY KEY,
    query TEXT NOT NULL,
    query_type TEXT, -- 'broad', 'niche', 'trending', 'cross_topic'
    search_method TEXT, -- 'youtube_search', 'video_search', 'google_pse'
    topic_category TEXT,
    results_returned INT DEFAULT 0,
    unique_channels_found INT DEFAULT 0,
    new_channels_imported INT DEFAULT 0,
    avg_channel_quality NUMERIC(3,2),
    execution_time_ms INT,
    api_units_used INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- Enhanced discovery metrics view
  CREATE OR REPLACE VIEW discovery_performance AS
  SELECT 
    DATE_TRUNC('day', created_at) as day,
    COUNT(*) as searches_run,
    SUM(unique_channels_found) as total_channels_found,
    SUM(new_channels_imported) as total_imported,
    AVG(avg_channel_quality) as avg_quality,
    SUM(api_units_used) as total_api_units
  FROM discovery_search_queries
  GROUP BY DATE_TRUNC('day', created_at);
  ```

### Phase 2: Scale Discovery with Smart Query Generation (Week 1-2) ✅ COMPLETED

#### Topic Analysis & Expansion
- [ ] Re-run BERTopic on current 171K videos (optional enhancement)
- [ ] Increase cluster count to 1,000+ for better granularity
- [ ] Export topic hierarchy and keywords
- [ ] Identify topic gaps (low representation areas)
- [ ] Create topic expansion map

#### Automated Query Generation System ✅ COMPLETED
- [x] Built query generator service (`/lib/discovery-query-generator.ts`)
- [x] Generates 100+ diverse queries across 8 topic categories
- [x] Supports gap-filling, trending, and cross-topic queries
- [ ] Create query templates:
  ```javascript
  const queryTemplates = {
    educational: [
      "{topic} full course 2025",
      "{topic} tutorial playlist",
      "{topic} masterclass free",
      "{topic} workshop recording",
      "{topic} bootcamp series"
    ],
    discovery: [
      "best {topic} youtube channels 2025",
      "{topic} experts youtube",
      "learn {topic} youtube playlist",
      "{topic} for beginners channel"
    ],
    crossTopic: [
      "{topic1} and {topic2} tutorial",
      "{topic1} vs {topic2} explained",
      "{topic1} for {topic2} developers"
    ],
    trending: [
      "{topic} 2025 trends",
      "new {topic} techniques",
      "{topic} latest updates"
    ]
  };
  ```

- [x] Implemented smart query allocation:
  - [x] Video-first searches via YouTube API (3-5 channels per search)
  - [x] Broad topic searches for maximum channel diversity
  - [x] Long-tail specific searches for niche channels
  - [x] Cross-topic searches to find educational hybrids
  - [x] Created batch search endpoint `/api/youtube/discovery/batch-search`

### Phase 3: Optimize Existing Discovery Pipeline (Week 2) ✅ COMPLETED

#### Enhance Video-First Discovery ✅
- [x] Channel extraction from video results already implemented
- [x] De-duplication logic exists in search endpoint
- [x] Scaled up concurrent searches (10 parallel)
- [x] Added batch search capability - 50+ searches in parallel

#### Optimize Channel Validation ✅
- [x] Channel validation already implemented in search endpoint
- [x] Batch validation processes 50 channels at once (1 API unit!)
- [ ] Create validation criteria:
  - [ ] Minimum 5,000 subscribers
  - [ ] Active in last 6 months
  - [ ] Minimum 10 videos
  - [ ] Average views > 1,000 per video
  - [ ] English language content (or target language)

#### Channel Scoring Algorithm
- [ ] Implement multi-factor scoring:
  ```javascript
  const scoringWeights = {
    subscribers: 0.20,      // Normalized to 100K
    consistency: 0.25,      // Upload frequency
    engagement: 0.25,       // Views/subscriber ratio
    recency: 0.15,         // Days since last upload
    topicRelevance: 0.15   // Alignment with target topics
  };
  ```

### Phase 4: Connect to Unified Import System (Week 2-3) ✅ COMPLETED

#### Integration with Existing Import ✅
- [x] Enhanced `/api/youtube/discovery/import-approved` endpoint
- [x] Connected to unified import system
- [x] Processes imports via `/api/video-import/unified`
- [x] Auto-approval implemented for high-scoring channels:
  - [ ] Tier 1: Import immediately (score > 0.8)
  - [ ] Tier 2: Import within 24h (score > 0.6)
  - [ ] Tier 3: Import within week (score > 0.4)
  - [ ] Tier 4: Review queue (score > 0.2)
  - [ ] Tier 5: Reject (score < 0.2)

#### API Usage Optimization
- [ ] Implement efficient pagination for channel videos
- [ ] Use fields parameter to minimize data transfer
- [ ] Cache channel metadata for 7 days
- [ ] Implement circuit breaker for API failures

### Phase 5: Aggressive Scaling Strategy (Week 3) 🚀 READY TO EXECUTE

#### Aggressive Discovery Targets
- [x] Can run 100+ searches daily (YouTube API only, no PSE needed)
- [x] Each search yields 3-5 unique channels = 300-500 channels/day
- [x] Auto-approve 60% (180-300 channels) for immediate import
- [ ] Import 200+ channels/day × 150 avg videos = 30,000 videos/day
- [ ] **Reach 1M videos in 25-30 days!**

#### Performance Monitoring
- [ ] Set up real-time metrics dashboard:
  - [ ] Channels discovered per hour
  - [ ] Import success rate
  - [ ] API quota usage
  - [ ] Videos per channel average
  - [ ] Topic coverage heatmap

#### Scale Optimizations
- [ ] Implement channel "related channels" discovery
- [ ] Add "featured channels" extraction
- [ ] Create channel collaboration network mapping
- [ ] Implement viral video → channel discovery

### Phase 6: Leverage All Discovery Endpoints (Week 4+) ✅ INTEGRATED

#### Use All Existing Discovery Methods
- [x] `/api/youtube/discovery/featured` - Featured channels
- [x] `/api/youtube/discovery/collaborations` - Channel collaborations
- [x] `/api/youtube/discovery/playlists` - Playlist analysis
- [x] `/api/youtube/discovery/shelves` - Channel shelves
- [x] `/api/youtube/discovery/comments` - Comment mining
- [x] `/api/youtube/discovery/crawl` - Deep channel crawling
- [x] Orchestrator combines all methods automatically

#### AI-Powered Expansion
- [ ] Implement semantic channel similarity
- [ ] Create channel recommendation engine
- [ ] Build topic prediction for emerging trends
- [ ] Implement quality prediction model

### Phase 7: Full Automation Pipeline (Week 4+) ✅ COMPLETED

#### Automated Discovery & Import Flow ✅
- [x] Created discovery orchestrator (`/api/youtube/discovery/orchestrator`)
- [x] Ready for scheduling (cron or manual trigger)
- [x] Auto-approves and imports high-quality channels
- [x] Integrated with existing worker infrastructure
- [x] Monitor via dashboard component or API

#### Maintenance Tasks
- [ ] Weekly topic model updates
- [ ] Monthly channel quality audits
- [ ] Quarterly strategy adjustments
- [ ] Regular query performance analysis

## Success Metrics & Targets

### 30-Day Targets
- [ ] 10,000+ unique channels discovered
- [ ] 3,000+ channels imported
- [ ] 450,000+ videos added
- [ ] 500+ topic categories covered

### 60-Day Targets
- [ ] 20,000+ unique channels discovered
- [ ] 8,000+ channels imported
- [ ] 1,000,000+ total videos (goal achieved!)
- [ ] 90% topic coverage across educational content

### 90-Day Targets
- [ ] 30,000+ unique channels discovered
- [ ] 15,000+ channels imported
- [ ] 2,000,000+ total videos
- [ ] Comprehensive educational content library

## Risk Mitigation

### API Quota Management
- [ ] Implement pre-flight quota checks
- [ ] Create quota reservation system
- [ ] Build fallback to manual review
- [ ] Set up quota alerts at 50%, 75%, 90%

### Quality Control
- [ ] Random sampling audits (1% of imports)
- [ ] User feedback integration
- [ ] Automated content quality checks
- [ ] Topic relevance validation

### Technical Safeguards
- [ ] Implement rate limiting
- [ ] Add retry logic with exponential backoff
- [ ] Create data backup procedures
- [ ] Set up rollback mechanisms

## Resource Requirements

### Development Team
- [ ] 1 Backend engineer (API integration)
- [ ] 1 Data engineer (pipeline optimization)
- [ ] 1 ML engineer (topic modeling, scoring)
- [ ] 1 DevOps engineer (scaling, monitoring)

### Infrastructure
- [ ] Scaled database capacity (+10TB)
- [ ] Increased API quotas (consider paid tiers)
- [ ] Enhanced monitoring tools
- [ ] Backup storage systems

### Budget Considerations
- [ ] Google PSE paid tier ($5/1000 queries after free 100)
- [ ] YouTube API quota increase (if needed)
- [ ] Additional OpenAI credits for classification
- [ ] Infrastructure scaling costs

## Implementation Status 🎉

### ✅ COMPLETED (All Core Features Ready!)
- Query generation service with 100+ daily queries
- Batch search endpoint processing 50+ searches in parallel
- Auto-approval logic for high-quality channels
- Discovery orchestrator coordinating all operations
- Dashboard component for monitoring and control
- Database schema enhanced with performance tracking

### 🚀 READY TO SCALE
- **Day 1**: Run orchestrator → discover 300-500 channels
- **Day 2-7**: Import 200+ channels/day → 30,000 videos/day
- **Day 10-15**: Scale to 500+ channels/day → 75,000 videos/day
- **Day 20-25**: Reach 1M videos milestone!

### Week 4: Enhancement
- Days 22-24: Advanced discovery methods
- Days 25-26: Quality improvements
- Days 27-28: Full automation

### Week 5+: Operation
- Daily discovery runs
- Weekly optimizations
- Monthly strategy reviews
- Continuous improvement

## Key Advantages of Using Existing System

- **No new infrastructure needed** - Tables and endpoints exist
- **Video-first search** extracts 3-5 channels per search query
- **Proven validation** logic already filters quality channels
- **Unified import** handles all the heavy lifting
- **Multiple discovery methods** beyond just search
- **Can process 500+ channels/day** with current infrastructure
- **50,000+ videos/day** achievable with optimization
- **Reach 1M videos in 20-25 days** of aggressive operation

## Quick Start Commands

```bash
# Test video-first discovery
curl -X POST http://localhost:3000/api/youtube/discovery/search \
  -H "Content-Type: application/json" \
  -d '{
    "searchTerm": "python tutorial 2025",
    "searchType": "video",
    "maxResults": 50,
    "filters": {
      "minSubscribers": 5000,
      "minVideos": 10
    }
  }'

# Import approved channels
curl -X POST http://localhost:3000/api/youtube/discovery/import-approved \
  -H "Content-Type: application/json" \
  -d '{"channelIds": ["UC...", "UC..."]}'

# Check discovery stats
curl http://localhost:3000/api/youtube/discovery/stats
```