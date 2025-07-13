# Video Analysis & Search System - Implementation TODO

## Current Status (2025-07-12)

### ✅ COMPLETED

#### BERTopic Topic Discovery
- [x] Generated 3-level hierarchy: 6 domains → 114 niches → 492 micro-topics
- [x] All 1,107 clusters have human-readable names
- [x] Cluster centroids calculated and stored in database
- [x] 57,069 videos assigned topics (July 10)

#### Format Classification System
- [x] Built LLM-based classification with GPT-4o-mini
- [x] 12 format types (added 5 new: live_stream, shorts, vlog, compilation, update)
- [x] Classified 78,465/79,733 videos (98.4% coverage)
- [x] Database constraint updated to allow all 12 format types
- [ ] Reclassifying 16,911 low-confidence videos (IN PROGRESS - Started 12:00 PM)

#### Infrastructure Built
- [x] Database schema: topic_level_1/2/3, format_type columns
- [x] TopicDetectionService: K-nearest neighbor topic assignment
- [x] LLMFormatClassificationService: Batch format classification
- [x] Unified video import pipeline with embeddings
- [ ] Classification hooks in import pipeline (not yet integrated)

### 🚨 IMMEDIATE NEXT STEPS

#### 1. Topic Assignment for New Videos (PRIORITY)
- [ ] Create `classify-topics-for-new-videos.js` script
- [ ] Run topic classification on 40,498 videos missing topics
- [ ] Verify all videos have topic assignments
- [ ] Update import pipeline to auto-assign topics

**Implementation Notes**:
- Use existing TopicDetectionService with k-nearest neighbor
- Process videos with title embeddings but no topic assignments
- Estimated time: ~1-2 hours for 40k videos

#### 2. Complete Format Classification
- [ ] Wait for current reclassification to finish (~30 mins remaining)
- [ ] Classify remaining 1,268 unclassified videos
- [ ] Validate confidence score improvements
- [ ] Generate classification quality report

#### 3. Deep Format Analysis
- [ ] Export top 20% performers by topic/format combination
- [ ] Export bottom 20% for anti-pattern analysis
- [ ] Generate cross-topic format performance matrix
- [ ] Analyze format success rates by niche

## Phase 1: Search & Discovery UI (Next Week)

### API Development
- [ ] Create `/api/youtube/advanced-search` endpoint
  - [ ] Multi-dimensional filtering (topic + format + performance)
  - [ ] Pagination and sorting
  - [ ] Performance optimization (<500ms response time)
- [ ] Create `/api/youtube/patterns/:topicId` endpoint
  - [ ] Calculate format performance by topic
  - [ ] Identify cross-niche opportunities
  - [ ] Build saturation indicators
- [ ] Create `/api/youtube/stats/overview` endpoint
  - [ ] Topic/format distribution metrics
  - [ ] Performance benchmarks by category

### UI Components
- [ ] Add "Discovery" tab to YouTube dashboard navigation
- [ ] Build search interface
  - [ ] Search input with autocomplete
  - [ ] Hierarchical topic selector
  - [ ] Format filter checkboxes
  - [ ] Performance range slider
  - [ ] Time period selector
- [ ] Create results display
  - [ ] "In Your Niche" section
  - [ ] "Cross-Niche Opportunities" section
  - [ ] Format performance charts
  - [ ] Video cards with metrics
- [ ] Build insights panel
  - [ ] Dynamic insight generation
  - [ ] Actionable recommendations
  - [ ] Emerging pattern alerts

## Phase 2: Real-Time Classification (Following Week)

### Import Pipeline Integration
- [ ] Integrate TopicDetectionService into unified import
  - [ ] Add topic assignment after embedding generation
  - [ ] Set confidence threshold: 0.3
  - [ ] Handle low-confidence fallbacks
- [ ] Integrate Format Detection
  - [ ] Add LLM classification to import flow
  - [ ] Batch new videos for efficiency
  - [ ] Track classification costs
- [ ] Update import monitoring
  - [ ] Add classification success metrics
  - [ ] Create cost tracking dashboard

## Phase 3: Intelligence Layer (Week 3+)

### Pattern Extraction
- [ ] Set up weekly outlier detection job
- [ ] Create LLM batch analysis pipeline
- [ ] Build pattern storage system
- [ ] Implement trend detection algorithms

### Advanced Features
- [ ] Thumbnail pattern analysis
  - [ ] Use existing CLIP embeddings
  - [ ] Find visual success patterns
  - [ ] Cross-reference with performance
- [ ] Predictive modeling
  - [ ] Build performance prediction model
  - [ ] Create "success probability" scores
- [ ] Personalization
  - [ ] User preference tracking
  - [ ] Customized recommendations

## Key Metrics to Track
- [ ] Topic coverage: Target 100% (currently 50%)
- [ ] Format coverage: Target 100% (currently 98.4%)
- [ ] Classification confidence: Target >80% average
- [ ] Search response time: Target <500ms
- [ ] UI load time: Target <3s for 1000 results

## Technical Debt & Optimization
- [ ] Create database indexes for performance queries
- [ ] Implement Redis caching for common searches
- [ ] Add classification quality monitoring
- [ ] Build feedback loop for improvements
- [ ] Optimize embedding similarity calculations
- [ ] Add batch processing for large result sets

## Scripts & Tools Needed
- [ ] `classify-topics-for-new-videos.js` - Assign topics to 40k videos
- [ ] `export-for-pattern-analysis.js` - Export top/bottom performers
- [ ] `generate-cross-niche-matrix.js` - Build opportunity matrix
- [ ] `monitor-classification-quality.js` - Track accuracy over time
- [ ] `backfill-missing-embeddings.js` - Ensure all videos have embeddings
- [ ] `calculate-topic-performance.js` - Generate performance benchmarks

## Critical Path
1. **Complete all classifications** (topics + formats) - Week 1
2. **Build search API & UI** - Week 2
3. **Add real-time classification** - Week 3
4. **Deploy intelligence features** - Week 4+

## Notes
- Topic classification MUST be completed before building search UI
- Format reclassification will improve data quality significantly
- Focus on getting all videos classified before deep analysis
- Real-time classification can be added after search UI ships
- Keep UI simple initially, add advanced features iteratively