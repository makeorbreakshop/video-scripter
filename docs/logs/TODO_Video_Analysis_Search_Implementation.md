# Video Analysis & Search System - Implementation TODO

Based on PRD: `/docs/PRD_Video_Analysis_Search_System.md`

## Phase 0: Topic & Format Discovery (Day 1-2)

### Data Preparation
- [x] Aggregate all title embeddings from `/exports/title-embeddings-*.json` into single file
- [x] Create script to merge embeddings with current video metadata from database
- [x] Ensure all 56k+ videos have embeddings included

### BERTopic Analysis
- [x] Run BERTopic with multiple granularity levels:
  - [x] ~8-12 clusters (broad domains) - **Achieved: 6 domains**
  - [x] ~50-100 clusters (specific niches) - **Achieved: 114 niches**
  - [x] ~200-500 clusters (micro-topics - similar to previous 492) - **Achieved: 492 micro-topics**
- [x] Export cluster assignments and representative videos
- [x] Generate cluster relationship mapping (which micro-topics group into niches, which group into domains)

### Topic Hierarchy Design
- [ ] Create flexible hierarchy system with 2 core levels:
  - [ ] Level 1: Domain (8-12 broad categories like Technology, Lifestyle, Education)
  - [ ] Level 2: Niche (50-100 specific topics like 3D Printing, Woodworking, Cooking)
- [ ] Add optional Level 3+ (micro-topics) based on automatic depth detection:
  - [ ] Video volume threshold (>500 videos suggests split needed)
  - [ ] Performance variance (high variance indicates distinct sub-topics)
  - [ ] Embedding distance spread (>0.4 indicates natural sub-clusters)
  - [ ] Keyword diversity (<30% overlap suggests multiple topics)
- [ ] Implement automatic depth detection algorithm:
  ```
  Criteria for deeper levels:
  - Video count > 1000 → definitely split
  - Performance std deviation > 2.0 → likely different sub-topics
  - Intra-cluster embedding spread > 0.4 → natural sub-clusters exist
  - Top 10 keyword overlap < 30% → distinct topics merged
  ```

### Topic Naming & Validation with Claude Code

#### Stage 1: Cluster Analysis Preparation
- [x] Export BERTopic cluster results with:
  - [x] Cluster IDs and sizes
  - [x] Top 10-20 representative videos per cluster
  - [x] Cluster keywords/terms from BERTopic
  - [x] Performance statistics per cluster
  - [x] Inter-cluster distances for hierarchy mapping

#### Stage 2: Claude Code Topic Naming Analysis
- [x] Domain Level Naming (6 clusters):
  - [x] Analyze representative videos to identify broad themes
  - [x] Generate clear, creator-friendly domain names
  - [x] Ensure mutual exclusivity and complete coverage
  - [x] Generated: "Technology & Engineering", "Practical Skills & Tutorials", "Adventure & Exploration", "Lifestyle & Culture", "Science & Space", "Arts & Design"
- [x] Niche Level Naming (114 clusters):
  - [x] Create specific but not overly narrow names
  - [x] Maintain consistency with parent domain naming
  - [x] Include popular search terms creators would recognize
  - [x] Examples: "3D Printing Projects", "Drone Technology", "Space Exploration", "Cooking & Recipes"
- [x] Micro-Topic Naming (492 clusters):
  - [x] Generate highly specific names for granular clusters
  - [x] Include key differentiators in names
  - [x] Balance specificity with discoverability
  - [x] Examples: "Arduino Projects", "FPV Drone Racing", "Mars Exploration", "Japanese Cuisine"

#### Stage 3: Hierarchy Validation & Refinement
- [x] Map parent-child relationships based on:
  - [x] Semantic similarity from embeddings
  - [x] Shared keywords and topics
  - [x] Natural conceptual groupings
- [x] Validate naming consistency across levels
- [x] Test names with edge case videos
- [ ] Create naming guidelines for future clusters

#### Stage 4: Documentation & Approval
- [ ] Generate comprehensive naming document with:
  - [ ] Full hierarchy visualization
  - [ ] 5-10 example videos per topic
  - [ ] Rationale for each name choice
  - [ ] Alternative naming options considered
- [ ] Review and approve names together
- [ ] Create naming convention guide for consistency

### Format Discovery & Deep Analysis with Claude Code

#### Stage 1: Data Preparation for Analysis
- [ ] Export stratified sample for Claude Code analysis:
  - [ ] Top 20% performers across all topics (1000-2000 videos)
  - [ ] Bottom 20% performers for anti-pattern analysis
  - [ ] Time-based samples (quarterly) for trend detection
  - [ ] Include: title, description, performance metrics, topic clusters
- [ ] Create export scripts:
  - [ ] `export-for-claude.js --top-performers --by-cluster`
  - [ ] `export-for-claude.js --quarterly --last-2-years`
  - [ ] `export-for-claude.js --uncategorized --sample-1000`

#### Stage 2: Claude Code Comprehensive Analysis
- [ ] Broad Pattern Mining:
  - [ ] Analyze 1000+ top performers for universal success patterns
  - [ ] Extract linguistic patterns and psychological triggers
  - [ ] Identify 20-30 distinct format types (more nuanced than basic 8-10)
- [ ] Niche-Specific Deep Dive:
  - [ ] Analyze 100-200 videos per major topic cluster
  - [ ] Find niche-specific format variations
  - [ ] Create cross-pollination opportunity matrix
- [ ] Failure Analysis:
  - [ ] Analyze bottom 20% performers
  - [ ] Identify toxic patterns and oversaturated formats
  - [ ] Document "formats to avoid" by niche
- [ ] Emerging Trends Analysis:
  - [ ] Compare patterns across time periods
  - [ ] Identify rising/declining formats
  - [ ] Predict next format innovations

#### Stage 3: Pattern Extraction & Rules Generation
- [ ] Create format taxonomy document with:
  - [ ] Format names and descriptions
  - [ ] Performance metrics by format
  - [ ] Niche-specific variations
  - [ ] Best/worst performing combinations
- [ ] Generate detection rules:
  - [ ] Regex patterns with confidence scores
  - [ ] Keyword-based detection fallbacks
  - [ ] Negative signals to improve accuracy
- [ ] Build format performance matrix:
  - [ ] Format success rates by niche
  - [ ] Cross-niche transferability scores
  - [ ] Saturation indicators

#### Stage 4: Implementation & Validation
- [ ] Implement hybrid detection system:
  - [ ] Primary: Regex patterns (fast, 90% coverage)
  - [ ] Secondary: Keyword matching (medium, 8% coverage)
  - [ ] Tertiary: LLM classification for ambiguous cases (2% coverage)
- [ ] Test detection accuracy on full dataset
- [ ] Handle multi-format videos (e.g., "Tutorial + Review")
- [ ] Create confidence scoring system

## Phase 1: Foundation Infrastructure (Week 1)

### Database Schema
- [x] Create migration to add columns to videos table:
  - [x] `topic_level_1` (domain)
  - [x] `topic_level_2` (niche)  
  - [x] `topic_level_3` (micro-topic)
  - [ ] `topic_depth` (integer indicating hierarchy depth for this video)
  - [ ] `format_primary`
  - [ ] `classification_confidence`
- [x] Create `topic_categories` table with hierarchy relationships
- [ ] Create `topic_depth_criteria` table to track why topics have certain depths
- [ ] Create `format_patterns` table
- [ ] Create indexes for performance

### Classification Pipeline
- [x] Build topic assignment service using BERTopic results
- [ ] Implement format detection service using regex patterns
- [ ] Create classification confidence scoring
- [ ] Add classification to video import pipeline
- [x] Build batch classification script for existing videos

### Data Backfill
- [x] Run classification on all 57k existing videos (57,069 videos updated)
- [x] Verify classification coverage and accuracy
- [x] Handle edge cases and unclassified videos (marked as -1)
- [ ] Generate classification quality report

## Phase 2: API Development (Week 1-2)

### Core Search API
- [ ] Create `/api/youtube/advanced-search` endpoint
- [ ] Implement multi-dimensional filtering:
  - [ ] Topic hierarchy filtering
  - [ ] Format filtering
  - [ ] Performance range filtering
  - [ ] Time period filtering
- [ ] Add pagination and sorting
- [ ] Implement search relevance scoring

### Pattern Analysis API
- [ ] Create `/api/youtube/patterns/:topicId` endpoint
- [ ] Calculate format performance by topic
- [ ] Identify emerging format trends
- [ ] Generate cross-niche opportunities
- [ ] Detect saturation indicators

### Statistics API
- [ ] Create endpoints for aggregate statistics
- [ ] Topic/format distribution metrics
- [ ] Performance benchmarks by category
- [ ] Trend analysis over time

## Phase 3: User Interface (Week 2-3)

### Discovery Tab Setup
- [ ] Add new "Discovery" tab to YouTube Dashboard navigation
- [ ] Create base page component and routing
- [ ] Set up state management for filters and results

### Search Interface
- [ ] Build search input with autocomplete
- [ ] Create hierarchical topic selector component
- [ ] Implement format filter checkboxes
- [ ] Add performance range slider
- [ ] Create time period selector

### Results Display
- [ ] Design result layout with sections:
  - [ ] "In Your Niche" section
  - [ ] "Cross-Niche Opportunities" section
  - [ ] "Format Performance" charts
  - [ ] "Emerging Patterns" alerts
- [ ] Implement video cards with key metrics
- [ ] Add performance comparison indicators
- [ ] Create "Why this worked" tooltips

### Insights Panel
- [ ] Build dynamic insights generation
- [ ] Create insight card components
- [ ] Implement insight prioritization
- [ ] Add actionable recommendations

## Phase 4: Intelligence Layer (Week 3-4)

### Level 2 Pattern Extraction
- [ ] Set up weekly outlier detection job
- [ ] Create LLM batch analysis pipeline
- [ ] Build pattern storage and versioning
- [ ] Implement pattern confidence scoring

### Cross-Niche Discovery
- [ ] Build format similarity matrix
- [ ] Create opportunity scoring algorithm
- [ ] Implement transferability predictions
- [ ] Generate opportunity alerts

### Trend Detection
- [ ] Implement format adoption tracking
- [ ] Create saturation detection algorithm
- [ ] Build early trend indicators
- [ ] Generate trend alerts and warnings

## Phase 5: Testing & Optimization (Week 4)

### Quality Assurance
- [ ] Manual validation of classifications (sample 100 per category)
- [ ] Test search relevance and ranking
- [ ] Verify cross-niche recommendations
- [ ] Validate performance calculations

### Performance Optimization
- [ ] Optimize database queries with proper indexes
- [ ] Implement caching for common searches
- [ ] Add query result caching
- [ ] Optimize frontend rendering for large result sets

### User Testing
- [ ] Internal team testing and feedback
- [ ] Fix identified issues
- [ ] Refine UI based on feedback
- [ ] Create user documentation

## Phase 6: Level 3 Integration (Future)

### Deep Analysis Features
- [ ] Design Level 3 analysis triggers
- [ ] Create deep analysis UI
- [ ] Implement analysis caching
- [ ] Build analysis history

### Advanced Features
- [ ] Thumbnail pattern analysis using CLIP embeddings
- [ ] Predictive performance modeling
- [ ] Personalized recommendations
- [ ] Export and reporting tools

## Ongoing Tasks

### Monitoring & Maintenance
- [ ] Set up classification quality monitoring
- [ ] Create pattern drift detection
- [ ] Build topic evolution tracking
- [ ] Implement feedback collection

### Documentation
- [ ] Create user guide for Discovery tab
- [ ] Document classification methodology
- [ ] Build pattern interpretation guide
- [ ] Create best practices documentation

## Success Criteria

- [ ] All 57k videos classified with >90% confidence
- [ ] Search returns relevant results in <500ms
- [ ] Cross-niche recommendations show >2x performance
- [ ] UI loads and renders smoothly with 1000+ results
- [ ] Weekly pattern updates run automatically

## Progress Notes (2025-07-10)

### Completed Today:
1. **BERTopic Analysis Improvements**
   - Fixed initial analysis issues where "Maker Show Episodes" was incorrectly categorized
   - Reran analysis with improved title cleaning to remove format indicators
   - Successfully generated 6 Level 1 domains (vs previous 39 - much cleaner)
   - Generated complete 3-level hierarchy: 6 domains → 114 niches → 492 micro-topics

2. **Topic Naming with Claude Code**
   - Analyzed all cluster representatives and generated human-readable names
   - Created content-focused names that avoid format confusion
   - Applied all topic names to database `topic_categories` table

3. **Database Updates**
   - Successfully updated all 57,069 videos with topic assignments
   - Overcame Supabase connection challenges (MCP read-only, needed direct psql)
   - Split bulk updates into 58 batch files to avoid timeouts

### Key Learnings:
- Aggressive HDBSCAN parameters (min_cluster_size=500) work better for Level 1
- Title cleaning is critical - remove format indicators before clustering
- Supabase SQL editor has 1.54 MB file size limit
- MCP connection is read-only; write operations need direct database password

## Original Notes

- BERTopic analysis is foundational - nothing else can start until Phase 0 completes
- Claude Code format analysis can run in parallel with BERTopic for maximum efficiency
- UI development can happen in parallel with API development
- Level 2 pattern extraction can be built while Level 1 is being deployed
- Focus on shipping Level 1 quickly, then iterate with Level 2 insights

## Expected Deliverables from Claude Code Analysis

### 1. Topic Hierarchy Naming Document ✅
- [x] Complete hierarchy with human-readable names for all clusters
- [x] Domain level: 6 broad categories with clear boundaries
- [x] Niche level: 114 specific topics that creators identify with
- [x] Micro level: 492 granular topics with searchable names
- [x] Parent-child relationship mapping with rationale
- [x] Example videos (5-10) for each topic level
- [ ] Alternative naming options for review

### 2. Format Taxonomy Document
- 20-30 distinct formats with clear definitions
- Performance metrics for each format
- Niche-specific variations and success rates
- Examples from top performers

### 3. Pattern Recognition Rules
- Regex patterns with confidence scores
- Negative signals for improved accuracy
- Multi-format detection logic
- Fallback classification strategies

### 4. Strategic Insights
- Cross-niche opportunity matrix (which formats transfer well)
- Saturation indicators by format/niche
- Emerging format predictions
- Toxic pattern warnings

### 5. Implementation Guidelines
- Optimal detection pipeline (regex → keyword → LLM)
- Confidence scoring methodology
- Edge case handling strategies
- Performance optimization tips
- Naming convention guide for future topics