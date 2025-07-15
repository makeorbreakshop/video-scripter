# Pattern Mining Implementation Plan

## Overview
This document outlines the plan for building a pattern mining system that helps YouTube creators improve their content by learning from successful videos in their niche. The system discovers what works in specific contexts and provides actionable recommendations.

## Core Value Proposition
**For Creators**: Learn from patterns that work in YOUR specific niche, not generic YouTube advice.
- "In beginner woodworking, 'mistakes' videos perform 5x better"
- "For cooking channels, 15-20 min tutorials outperform quick recipes"
- "Tech reviews see 40% boost with comparison formats"

## Current System Integration Points

### Existing Infrastructure We'll Build On:
- **Video Database**: 100K+ videos with title, views, performance metrics
- **Embeddings**: Title embeddings (512D) and thumbnail embeddings (768D) via Pinecone
- **Classification**: Format types and BERT topic clusters already in place
- **Search System**: Pattern analysis page with semantic and keyword search
- **Workers**: Background processing infrastructure for continuous updates

### New Capabilities to Add:
- Multi-scale pattern discovery
- Bottom-up pattern mining  
- Pattern performance tracking across semantic regions
- Context-aware pattern recommendations

### Currently Untapped Data Sources:
- **Duration patterns** - Optimal video lengths by niche
- **Title structure** - Word count, punctuation, capitalization patterns
- **Publishing timing** - Day of week, time of day, seasonal patterns
- **Compound patterns** - Combinations that work together
- **Topic clusters** - Using existing BERT classifications

### Future Data Sources (System Ready to Accept):
- **Thumbnail patterns** - Visual elements, colors, faces, text (when vectorized)
- **Script patterns** - Hooks, story structures, CTAs (when available)
- **Cross-modal patterns** - Title+thumbnail alignment, script+visual coherence

---

## Phase 1: Database Schema (Simplified)

### [ ] Core Pattern Storage - Just 2 Tables
```sql
-- 1. Patterns table (all discovered patterns)
CREATE TABLE patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL, -- 'title', 'format', 'timing', 'duration', 'compound', 'thumbnail', 'script'
  pattern_data JSONB NOT NULL, -- Everything about the pattern
  embedding VECTOR(512), -- Semantic location where pattern works
  performance_stats JSONB, -- All performance data (by region, over time)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Example pattern_data structures:

-- Title Pattern:
-- {
--   "name": "Beginner mistakes format",
--   "template": "[SKILL_LEVEL] Mistakes I Made [CONTEXT]",
--   "examples": ["Beginner Mistakes I Made Woodworking"],
--   "discovery_method": "statistical_outlier",
--   "evidence_count": 47,
--   "confidence": 0.92
-- }

-- Duration Pattern:
-- {
--   "name": "Optimal tutorial length",
--   "duration_range": "15-20min",
--   "context": "woodworking_tutorials",
--   "discovery_method": "duration_analysis",
--   "evidence_count": 123,
--   "performance_vs_baseline": 2.3
-- }

-- Future Thumbnail Pattern:
-- {
--   "name": "Red arrow emphasis",
--   "visual_elements": ["red_arrow", "surprised_face", "object_highlight"],
--   "position": "top_right",
--   "discovery_method": "thumbnail_clustering",
--   "evidence_count": 89
-- }

-- Future Script Pattern:
-- {
--   "name": "Problem-agitate-solve",
--   "structure": ["problem_hook", "pain_points", "solution_reveal"],
--   "avg_section_seconds": [15, 45, 180],
--   "discovery_method": "script_structure_analysis",
--   "evidence_count": 67
-- }

-- Example performance_stats:
-- {
--   "overall": { "avg": 3.2, "median": 2.8, "count": 47 },
--   "by_context": {
--     "woodworking": { "avg": 5.1, "count": 12 },
--     "general_diy": { "avg": 2.1, "count": 35 }
--   },
--   "timeline": [
--     { "month": "2024-01", "performance": 3.5, "adopters": 5 },
--     { "month": "2024-02", "performance": 3.0, "adopters": 8 }
--   ],
--   "saturation_score": 0.3
-- }

-- 2. Video-Pattern associations
CREATE TABLE video_patterns (
  video_id TEXT REFERENCES videos(id),
  pattern_id UUID REFERENCES patterns(id),
  match_score FLOAT, -- How well video matches pattern (0-1)
  discovered_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (video_id, pattern_id)
);

-- Indexes for performance
CREATE INDEX idx_patterns_embedding ON patterns USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_patterns_type ON patterns(pattern_type);
CREATE INDEX idx_video_patterns_video ON video_patterns(video_id);
```

---

## Phase 2: Pattern Discovery Pipeline

### [ ] Core Discovery Process
```python
# Main discovery flow - runs daily/weekly
async def discover_patterns():
    # 1. Get semantic clusters
    clusters = await get_semantic_clusters(min_size=50)
    
    # 2. For each cluster, find high performers
    for cluster in clusters:
        high_performers = await get_videos(
            cluster_id=cluster.id,
            performance_ratio > 2.0,
            confidence_score > 0.8  # Only established videos
        )
        
        # 3. Run ALL pattern discovery methods
        pattern_analyzers = [
            TitlePatternAnalyzer(),
            TitleStructureAnalyzer(),
            FormatOutlierAnalyzer(),
            DurationPatternAnalyzer(),
            TimingPatternAnalyzer(),
            CompoundPatternAnalyzer(),
            TopicClusterAnalyzer(),
            # Future analyzers plug in here:
            # ThumbnailPatternAnalyzer(),
            # ScriptStructureAnalyzer(),
            # CrossModalPatternAnalyzer()
        ]
        
        patterns = []
        for analyzer in pattern_analyzers:
            discovered = await analyzer.discover(high_performers, cluster)
            patterns.extend(discovered)
        
        # 4. Validate and store patterns
        for pattern in patterns:
            if await validate_pattern(pattern):
                await store_pattern(pattern)
```

### [ ] Pattern Discovery Methods

#### [ ] Statistical Pattern Mining
```python
def statistical_pattern_discovery(videos):
    # Find what high performers have in common
    winners = filter(lambda v: v.performance > 3.0, videos)
    losers = filter(lambda v: v.performance < 0.5, videos)
    
    # Extract all measurable features
    winner_features = extract_all_features(winners)
    loser_features = extract_all_features(losers)
    
    # Find statistically significant differences
    patterns = find_significant_differences(winner_features, loser_features)
    return patterns
```

#### [ ] Title Pattern Extraction
```python
def extract_title_patterns(videos):
    patterns = []
    
    # N-gram analysis (1-5 word combinations)
    ngrams = extract_ngrams(videos.titles, n_range=(1,5))
    high_performing_ngrams = filter_by_performance(ngrams)
    
    # Convert to reusable templates
    for ngram in high_performing_ngrams:
        template = generalize_pattern(ngram)
        # "5 beginner woodworking" → "[NUMBER] [SKILL_LEVEL] [TOPIC]"
        patterns.append(template)
    
    # Title structure patterns
    title_structures = analyze_title_structure(videos)
    patterns.extend(title_structures)
    
    return patterns
```

#### [ ] Title Structure Analysis
```python
def analyze_title_structure(videos):
    structures = []
    
    # Word count patterns
    word_count_performance = group_by_word_count(videos)
    
    # Punctuation patterns (questions, colons, dashes)
    punctuation_patterns = analyze_punctuation_impact(videos)
    
    # Capitalization patterns
    caps_patterns = analyze_capitalization(videos)
    
    # Emoji usage
    emoji_patterns = analyze_emoji_performance(videos)
    
    return structures
```

#### [ ] Duration Pattern Discovery
```python
def discover_duration_patterns(videos):
    # Group videos by duration buckets
    duration_buckets = {
        '0-60s': [],
        '1-5min': [],
        '5-10min': [],
        '10-15min': [],
        '15-25min': [],
        '25min+': []
    }
    
    # Find optimal durations by niche
    for cluster in semantic_clusters:
        cluster_videos = filter_by_cluster(videos, cluster)
        optimal_duration = find_best_performing_duration(cluster_videos)
        
        patterns.append({
            'type': 'duration',
            'context': cluster.name,
            'optimal_range': optimal_duration,
            'performance_lift': calculate_lift(optimal_duration)
        })
```

#### [ ] Publishing Time Patterns
```python
def discover_timing_patterns(videos):
    patterns = []
    
    # Day of week analysis
    dow_performance = analyze_by_weekday(videos)
    
    # Time of day analysis (if available)
    tod_performance = analyze_by_hour(videos)
    
    # Seasonal patterns
    seasonal_patterns = analyze_by_month(videos)
    
    # Combine with niche for context-specific timing
    for cluster in semantic_clusters:
        cluster_timing = analyze_cluster_timing(cluster, videos)
        patterns.append(cluster_timing)
    
    return patterns
```

#### [ ] Format Outlier Detection
```python
def find_format_outliers(cluster_videos):
    # Get baseline format performance
    format_baseline = calculate_format_baseline(all_videos)
    
    # Find formats that overperform in this cluster
    cluster_formats = calculate_format_performance(cluster_videos)
    
    outliers = []
    for format, performance in cluster_formats.items():
        if performance > format_baseline[format] * 1.5:
            outliers.append({
                'format': format,
                'context': cluster.name,
                'lift': performance / format_baseline[format]
            })
    
    return outliers
```

#### [ ] Compound Pattern Discovery
```python
def discover_compound_patterns(videos):
    # Find combinations that work together
    # Example: "Tutorial" + "15-20min" + "Tuesday" = 5x
    
    feature_combinations = []
    
    # Test 2-way combinations
    for feature1 in all_features:
        for feature2 in all_features:
            if feature1 != feature2:
                combo_performance = test_combination(videos, [feature1, feature2])
                if combo_performance > threshold:
                    feature_combinations.append({
                        'features': [feature1, feature2],
                        'performance': combo_performance
                    })
    
    # Test 3-way combinations for top performers
    # ... similar logic
    
    return feature_combinations
```

#### [ ] Topic Cluster Pattern Analysis
```python
def analyze_topic_patterns(videos):
    # Use existing BERT topic clusters
    patterns = []
    
    for topic_cluster in get_all_topic_clusters():
        cluster_videos = filter_by_topic(videos, topic_cluster)
        
        # What works in this topic?
        topic_patterns = {
            'cluster': topic_cluster.name,
            'dominant_formats': get_top_formats(cluster_videos),
            'avg_performance': calculate_avg_performance(cluster_videos),
            'unique_patterns': find_unique_to_cluster(cluster_videos)
        }
        
        patterns.append(topic_patterns)
    
    return patterns
```

### [ ] Pattern Validation
```python
def validate_pattern(pattern):
    # Minimum requirements
    if pattern.sample_size < 30:
        return False
    
    # Performance consistency
    if pattern.performance_variance > 2.0:
        return False
    
    # Not too universal (works everywhere = not valuable)
    if pattern.works_in_contexts > 0.8:
        pattern.value_score *= 0.5
    
    # Statistical significance
    if pattern.p_value > 0.05:
        return False
    
    return True
```

### [ ] Confidence-Based Performance Scoring
- [ ] Add age-based confidence scoring to handle recency bias
  - Videos under 7 days: 30% confidence weight
  - Videos 7-30 days: 30-80% confidence (progressive)
  - Videos over 30 days: 80-100% confidence
- [ ] For pattern discovery: Only use videos with confidence > 0.8 (24+ days old)
- [ ] For pattern display: Show all videos but indicate confidence level
- [ ] Create separate "Emerging Patterns" section for recent high-performers
- [ ] Prepare schema for future velocity tracking:
  ```sql
  ALTER TABLE videos ADD COLUMN IF NOT EXISTS first_day_views INTEGER;
  ALTER TABLE videos ADD COLUMN IF NOT EXISTS first_week_views INTEGER;
  ALTER TABLE videos ADD COLUMN IF NOT EXISTS first_month_views INTEGER;
  ALTER TABLE videos ADD COLUMN IF NOT EXISTS view_velocity_7d FLOAT;
  ALTER TABLE videos ADD COLUMN IF NOT EXISTS view_velocity_30d FLOAT;
  ALTER TABLE videos ADD COLUMN IF NOT EXISTS age_confidence FLOAT GENERATED ALWAYS AS 
    (LEAST(EXTRACT(EPOCH FROM (NOW() - published_at)) / (86400 * 30), 1.0)) STORED;
  ```

---

## Phase 3: Pattern Performance Tracking

### [ ] Pattern Performance Updates
```python
# Weekly job to update pattern performance
async def update_pattern_performance():
    patterns = await get_all_patterns()
    
    for pattern in patterns:
        # Get all videos matching this pattern
        matching_videos = await get_pattern_videos(pattern.id)
        
        # Recalculate performance by context
        performance_by_context = {}
        for context in get_unique_contexts(matching_videos):
            context_videos = filter_by_context(matching_videos, context)
            performance_by_context[context] = calculate_performance(context_videos)
        
        # Update pattern's performance stats
        await update_pattern(pattern.id, {
            'performance_stats': {
                'overall': calculate_overall_stats(matching_videos),
                'by_context': performance_by_context,
                'timeline': append_current_month_data(pattern.timeline),
                'saturation_score': calculate_saturation(matching_videos)
            }
        })
```

### [ ] Temporal Tracking (Stored in JSONB)
```python
# All temporal data lives in performance_stats JSONB
{
    "timeline": [
        {
            "month": "2024-01",
            "video_count": 45,
            "avg_performance": 3.2,
            "median_performance": 2.8,
            "variance": 1.4,
            "top_channels": ["Channel1", "Channel2"],
            "saturation_indicator": 0.2
        },
        # ... more months
    ],
    "lifecycle_stage": "growing",  # emerging|growing|mature|declining
    "first_seen": "2023-08-15",
    "peak_performance": {
        "month": "2024-03",
        "performance": 4.1
    },
    "adopters": {
        "early": ["InnovatorChannel1", "InnovatorChannel2"],
        "current_count": 156
    }
}
```

---

## Phase 4: Integration with Current System

### [ ] Enhance Pattern Analysis Page
- [ ] Add pattern insights to search results
- [ ] Show relevant patterns for searched topic
- [ ] Display pattern performance in local context
- [ ] Add "Why this works here" explanations

### [ ] New API Endpoints

#### [ ] Get Patterns for Creator's Niche
```typescript
POST /api/youtube/patterns/discover
{
  query: string,  // "beginner woodworking projects"
  limit?: number  // Default 20
}

Response:
{
  patterns: [{
    id: string,
    type: "title" | "format" | "timing",
    name: "Mistakes format",
    template: "[SKILL_LEVEL] Mistakes I Made [CONTEXT]",
    performance: {
      lift: 3.2,  // 3.2x average
      confidence: 0.92,
      sampleSize: 47
    },
    lifecycle: "growing",
    examples: Video[]
  }],
  context: "woodworking_beginner"
}
```

#### [ ] Predict Video Performance
```typescript
POST /api/youtube/patterns/predict
{
  title: string,
  format: string,
  niche: string
}

Response:
{
  predictedPerformance: 2.8,  // 2.8x channel average
  matchingPatterns: Pattern[],
  suggestions: [
    "Add 'Mistakes' to title for 3.2x boost",
    "Consider 15-20 min duration (optimal for your niche)"
  ]
}
```

### [ ] Worker Jobs
```javascript
// Pattern Discovery Worker (daily)
npm run worker:pattern-discovery

// Pattern Performance Update (weekly)  
npm run worker:pattern-performance

// New Video Pattern Matching (real-time)
npm run worker:pattern-matching
```

---

## Phase 5: Creator-Focused Features

### [ ] Pattern Recommendations for Creators
```python
def get_creator_recommendations(channel_id, niche_embedding):
    # 1. Find relevant patterns for their niche
    niche_patterns = get_patterns_near_embedding(niche_embedding, radius=0.3)
    
    # 2. Filter by opportunity
    opportunities = []
    for pattern in niche_patterns:
        if pattern.lifecycle_stage in ['emerging', 'growing']:
            if pattern.adopter_count < 50:  # Not saturated
                opportunities.append({
                    'pattern': pattern,
                    'opportunity_score': pattern.performance * (1 - pattern.saturation),
                    'reason': f"Early opportunity - only {pattern.adopter_count} channels using"
                })
    
    # 3. Personalize for channel
    return personalize_for_channel(opportunities, channel_id)
```

### [ ] Anti-Saturation Warnings
```python
def check_pattern_saturation(pattern):
    stats = pattern.performance_stats
    
    # Warning signs
    if stats['variance'] > 2.0 and stats['median'] < 1.0:
        return "⚠️ High variance - works for some, fails for many"
    
    if stats['timeline'][-1]['performance'] < stats['peak_performance'] * 0.5:
        return "📉 Declining - peaked {} months ago".format(months_since_peak)
    
    if stats['adopter_count'] > 100:
        return "🔥 Saturated - consider variations"
    
    return "✅ Healthy pattern"
```

---

## Phase 6: User Interface (Simplified)

### [ ] Creator Dashboard View
```
Your Niche: Beginner Woodworking

📈 Top Patterns in Your Space:
┌─────────────────────────────────────────────┐
│ "Mistakes I Made" Format     🟢 Growing    │
│ Performance: 3.2x avg        47 videos     │
│ Example: "5 Mistakes I Made Building..."   │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ "Under $50" Budget Content   🆕 Emerging   │
│ Performance: 2.8x avg        12 videos     │
│ Example: "Workshop Setup Under $50"        │
└─────────────────────────────────────────────┘

💡 Opportunities:
- Combine "Mistakes" + "Budget" (no one doing this yet)
- Tuesday uploads performing 40% better in your niche
```

### [ ] Pattern Details Modal
```
Pattern: "Mistakes Format"
Template: "[NUMBER] Mistakes I Made [DOING X]"

Performance by Context:
- Beginner Projects: 5.1x ⭐
- Tool Reviews: 1.2x
- Advanced Techniques: 0.8x ❌

Lifecycle: Started Aug 2023, Peak Mar 2024
Status: Still growing, ~30% adoption

Top Examples: [Video thumbnails]
```

---

## Phase 7: Future Enhancements

### [ ] Pattern Combination Analysis
- Identify patterns that work well together
- Warn about conflicting patterns
- Suggest compound strategies

### [ ] Seasonal Pattern Detection
- Track performance variations by time of year
- Identify holiday/event opportunities
- Predict seasonal trends

### [ ] Channel-Specific Learning
- Learn from creator's own successes
- Combine with niche patterns
- Personalized recommendations

### [ ] Thumbnail Pattern Analysis (When Vectorized)
```python
# Future thumbnail analyzer
class ThumbnailPatternAnalyzer:
    def discover(self, videos, cluster):
        # Cluster by visual similarity
        thumbnail_clusters = cluster_thumbnails(videos.thumbnail_embeddings)
        
        # Extract visual patterns
        patterns = []
        for thumb_cluster in thumbnail_clusters:
            if thumb_cluster.avg_performance > 2.0:
                patterns.append({
                    'type': 'thumbnail',
                    'visual_features': extract_features(thumb_cluster),
                    'color_palette': extract_colors(thumb_cluster),
                    'text_elements': extract_ocr_text(thumb_cluster),
                    'face_emotions': detect_faces(thumb_cluster)
                })
        
        return patterns
```

### [ ] Script Pattern Analysis (When Available)
```python
# Future script analyzer  
class ScriptStructureAnalyzer:
    def discover(self, videos, cluster):
        # Analyze script structures
        patterns = []
        
        # Hook patterns (first 15 seconds)
        hook_patterns = analyze_hooks(videos.scripts)
        
        # Story structures 
        structures = analyze_narrative_flow(videos.scripts)
        
        # CTA patterns
        cta_patterns = analyze_call_to_actions(videos.scripts)
        
        return patterns
```

### [ ] Cross-Modal Pattern Discovery
```python
# Combine multiple data types
class CrossModalAnalyzer:
    def discover(self, videos, cluster):
        # Title + Thumbnail combinations
        title_thumb_combos = find_synergistic_pairs(
            videos.titles, 
            videos.thumbnail_features
        )
        
        # Script + Visual alignment
        script_visual_alignment = analyze_coherence(
            videos.scripts,
            videos.thumbnail_features
        )
        
        return cross_modal_patterns
```

---

## Implementation Timeline

### Week 1-2: Database & Core Discovery
- [ ] Create 2 pattern tables
- [ ] Build semantic clustering
- [ ] Implement basic pattern discovery

### Week 3-4: Pattern Mining
- [ ] Title pattern extraction
- [ ] Title structure analysis (word count, punctuation, caps)
- [ ] Format outlier detection
- [ ] Duration pattern discovery
- [ ] Publishing time patterns
- [ ] Pattern validation logic

### Week 5-6: API & Integration
- [ ] Pattern discovery API endpoint
- [ ] Performance prediction endpoint
- [ ] Connect to existing pattern analysis page

### Week 7-8: Creator Features  
- [ ] Pattern recommendations
- [ ] Compound pattern discovery
- [ ] Topic cluster analysis
- [ ] Saturation warnings
- [ ] Basic UI components

### Week 9-10: Production & Testing
- [ ] Worker jobs setup
- [ ] Performance optimization
- [ ] User testing & refinement

---

## Success Metrics

### MVP Success Criteria
- [ ] Discover 100-200 meaningful patterns from existing data
- [ ] 80%+ accuracy in pattern-performance correlation
- [ ] <200ms API response time for pattern queries
- [ ] Patterns work in specific contexts (not universal)

### Creator Value Metrics  
- [ ] Creators find 3+ actionable insights per session
- [ ] Predicted performance within 30% of actual
- [ ] Clear differentiation from generic YouTube advice
- [ ] Positive feedback on niche-specific insights

---

## Technical Considerations

### Keep It Simple
- Start with 2 tables, add more only if needed
- JSONB for flexibility without schema migrations
- Use existing infrastructure (workers, embeddings)
- PostgreSQL handles our scale easily (100K videos → ~200 patterns)

### Pattern Quality
- Minimum 30 videos for pattern validation
- Only use videos with 80%+ age confidence
- Require statistical significance (p < 0.05)
- Context-specific validation (must work somewhere specific)

### Future-Proofing
- JSONB allows pattern evolution without migrations
- Worker architecture supports easy additions
- API-first for integration flexibility
- Clear value: niche-specific insights > generic advice