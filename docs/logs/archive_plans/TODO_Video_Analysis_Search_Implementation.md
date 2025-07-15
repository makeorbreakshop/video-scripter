# Video Analysis & Search System - Implementation TODO

## Current Status (2025-07-14)

### ✅ COMPLETED

#### BERTopic Topic Discovery
- [x] Generated 3-level hierarchy: 6 domains → 114 niches → 492 micro-topics
- [x] All 1,107 clusters have human-readable names
- [x] Cluster centroids calculated and stored in database
- [x] **100% topic coverage achieved** - All 84,203 videos have topic assignments

#### Format Classification System
- [x] Built LLM-based classification with GPT-4o-mini
- [x] 12 format types (added 5 new: live_stream, shorts, vlog, compilation, update)
- [x] **95.08% format coverage** - 80,057/84,203 videos classified
- [x] Database constraint updated to allow all 12 format types
- [x] Achieved average confidence of 84.37% (only 781 low-confidence videos)
- [x] Reclassification completed successfully

#### Infrastructure Built
- [x] Database schema: topic_level_1/2/3, format_type columns
- [x] TopicDetectionService: K-nearest neighbor topic assignment
- [x] LLMFormatClassificationService: Batch format classification
- [x] Unified video import pipeline with embeddings
- [x] Classification worker system (6 concurrent workers)
- [x] Auto-classification runner component
- [ ] Classification hooks in import pipeline (not yet integrated)

### 🚨 IMMEDIATE NEXT STEPS

#### 1. Complete Remaining Format Classification
- [ ] Classify remaining 4,146 unclassified videos (use dashboard at `/app/dashboard/youtube/categorization`)
- [x] Fixed LLM prompt to prevent invalid format suggestions
- [ ] Monitor low-confidence videos (781 remaining)
- [ ] Generate final classification quality report

#### 2. Integrate Classification into Import Pipeline
- [ ] Add topic assignment to unified import pipeline
- [ ] Add format classification to unified import pipeline
- [ ] Test end-to-end classification for new videos
- [ ] Deploy automated classification for all new imports

#### 3. Deep Format Analysis
- [ ] Export top 20% performers by topic/format combination
- [ ] Export bottom 20% for anti-pattern analysis
- [ ] Generate cross-topic format performance matrix
- [ ] Analyze format success rates by niche

## Phase 1: Pattern Analysis Interface - FINAL DESIGN (2025-07-14)

### 🎯 FINAL APPROACH - Fluid Search with Analysis Set

After extensive user research and iteration, the final design uses a single fluid search interface with adjustable parameters and a persistent analysis set panel.

### API Development
- [ ] Update `/api/youtube/pattern-search` endpoint
  - [ ] Natural language search with embeddings
  - [ ] Format filtering (when format selected)
  - [ ] Topic relevance scoring (0.0 - 1.0)
  - [ ] Performance filtering by ratio
  - [ ] Support pagination for continuous scrolling
- [ ] Create `/api/youtube/export-analysis` endpoint
  - [ ] Accept array of video IDs (15-30 videos)
  - [ ] Generate thumbnail grid as JPG
  - [ ] Return copyable title list
  - [ ] Include key metrics for each video

### UI Components - Two Panel Layout

#### Left Panel - Search & Results
- [ ] Natural language search box
- [ ] Format selector dropdown (12 format types)
- [ ] Two continuous sliders:
  - [ ] **Topic Relevance**: tight (0.9) ← → broad (0.4)
  - [ ] **Performance Threshold**: 2x ← → 50x
- [ ] Results grid:
  - [ ] Video cards with thumbnail, title, channel
  - [ ] Performance ratio badge
  - [ ] Checkbox for selection
  - [ ] Continuous scroll with pagination

#### Right Panel - Analysis Set
- [ ] Fixed panel showing selected videos
- [ ] Running count: "18 videos selected"
- [ ] Selected video list with:
  - [ ] Thumbnail preview
  - [ ] Title (truncated)
  - [ ] Remove button
- [ ] Export section at bottom:
  - [ ] "Generate Analysis Grid" button
  - [ ] "Copy All Titles" button
  - [ ] "Download Metrics CSV" button

### Search Implementation Logic
```
1. User enters: "iPhone 16"
2. Optionally selects format: "review"
3. Adjusts sliders:
   - Topic Relevance: Controls semantic similarity
   - Performance: Filters by performance_ratio

Backend query combines:
- Pinecone similarity search on query
- Format filter (if selected)
- Performance threshold filter
- Results sorted by relevance × performance
```

### User Workflow
1. Search for topic (e.g., "iPhone 16")
2. Optionally select format to explore
3. Start with tight relevance to see direct competition
4. Gradually broaden to discover patterns
5. Increase performance threshold for only top performers
6. Check videos to build ~20 video analysis set
7. Export for pattern analysis

### Technical Implementation
- Pinecone semantic search as primary engine
- Format filtering via database column (with confidence > 0.8)
- Real-time slider updates with debouncing
- Maintain selected videos in React state
- Canvas API for thumbnail grid generation
- Target <300ms search response time

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