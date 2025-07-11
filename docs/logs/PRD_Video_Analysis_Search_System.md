# Product Requirements Document: Video Analysis & Search System

## Executive Summary

A multi-level video analysis and discovery system that helps content creators identify successful video patterns within their niche and discover cross-niche format opportunities. The system categorizes videos by topic and format, analyzes performance patterns, and surfaces actionable insights for content planning.

## Problem Statement

Content creators currently lack:
1. Understanding of what video formats work best for their specific topic
2. Visibility into successful patterns from adjacent niches they could adapt
3. Data-driven insights beyond basic YouTube Analytics
4. Efficient ways to discover format innovations before they become saturated

## Solution Overview

A three-level analysis system integrated into the existing YouTube Dashboard:

**Level 1:** Automatic categorization of all videos (Topic + Format)
**Level 2:** Pattern extraction from performance outliers  
**Level 3:** Deep strategic analysis on-demand

## User Persona

**Primary User:** Content creators actively planning their next video
- Currently importing competitor channels for analysis
- Seeking data-driven content decisions
- Looking for format innovations to differentiate
- Want insights specific to their niche AND transferable patterns

## Core Features

### 1. Topic Hierarchy System

**Structure:**
```
Technology (10K videos)
├── Computing (4K)
├── Making/Hardware (3K)
│   ├── 3D Printing (1.2K)
│   ├── Laser Cutting (800)
│   └── CNC Machining (600)
└── Smart Home (3K)
```

**Implementation:**
- Use existing BERT topic clusters as foundation
- Create 3-level hierarchy: Broad → Sub → Micro
- Allow progressive disclosure in UI
- Human-readable names mapped to cluster IDs

### 2. Format Classification

**Primary Formats:**
- Tutorial - Step-by-step instruction
- Review - Product/service evaluation
- Showcase - Project/result display
- Comparison - X vs Y analysis
- Story - Narrative/experience
- List - Tips/recommendations
- News - Updates/announcements
- Challenge - Attempting difficulty
- Explanation - Concept breakdown

**Detection Method:**
- Title pattern matching (regex)
- Description keyword analysis
- Duration signals
- No LLM required for Level 1

### 3. Performance Pattern Analysis

**Metrics Tracked:**
- Performance ratio (vs channel baseline)
- Cross-niche format performance
- Time-based trends
- Saturation indicators

**Outlier Detection:**
- High performers: >2x channel average
- Low performers: <0.5x channel average
- Emerging patterns: rapid adoption signals

### 4. Discovery Interface

**New Tab in YouTube Dashboard:**

**Search & Filter:**
```
[Search: "laser cutting tutorials"] 

Topic: [All Topics ▼]  Format: [All Formats ▼]  Performance: [All ▼]  Time: [Last Year ▼]
```

**Results Display:**
1. **In Your Niche** - Direct competitors and patterns
2. **Cross-Niche Opportunities** - Same format, different topics
3. **Format Performance** - Success rates by combination
4. **Emerging Patterns** - New format/topic combinations gaining traction

**Insights Panel:**
- "Tutorials perform 3.2x better than Reviews in Laser Cutting"
- "Story format underutilized in your niche (only 2% of videos)"
- "Comparison videos trending up 40% MoM across all Making topics"

## Technical Architecture

### Data Pipeline

**Level 1 - Base Classification (Every Video):**
```python
Input: Video metadata (title, description, metrics)
Process: 
  - BERT embedding → Topic assignment
  - Regex patterns → Format detection
  - Performance calculation
Output: Categorized video with performance metrics
Cost: ~$0 (CPU only)
Frequency: On import
```

**Level 2 - Pattern Extraction (Top/Bottom 10%):**
```python
Input: Outlier videos by category
Process:
  - Batch LLM analysis (20 videos/prompt)
  - Statistical pattern mining
  - Cross-category correlation
Output: Success/failure patterns per category
Cost: ~$0.05 per batch
Frequency: Weekly
```

**Level 3 - Strategic Analysis (On-Demand):**
```python
Input: User query + 10-20 relevant videos
Process:
  - Deep content analysis
  - Competitive gaps
  - Actionable recommendations
Output: Detailed content strategy
Cost: ~$1-2 per analysis
Frequency: User-triggered
```

### Database Schema

```sql
-- Extend existing videos table
ALTER TABLE videos ADD COLUMN topic_level_1 TEXT;
ALTER TABLE videos ADD COLUMN topic_level_2 TEXT;
ALTER TABLE videos ADD COLUMN topic_level_3 TEXT[];
ALTER TABLE videos ADD COLUMN format_primary TEXT;
ALTER TABLE videos ADD COLUMN classification_confidence FLOAT;

-- New tables
CREATE TABLE topic_hierarchy (
  id SERIAL PRIMARY KEY,
  cluster_id INTEGER REFERENCES topic_clusters(id),
  level INTEGER,
  name TEXT,
  parent_id INTEGER REFERENCES topic_hierarchy(id),
  video_count INTEGER
);

CREATE TABLE format_patterns (
  topic_id INTEGER,
  format TEXT,
  time_period DATE,
  avg_performance FLOAT,
  sample_size INTEGER,
  success_patterns JSONB,
  failure_patterns JSONB
);
```

### API Endpoints

```typescript
// Search endpoint combining all signals
POST /api/youtube/advanced-search
{
  query?: string,
  topic?: string[],
  format?: string[],
  performanceMin?: number,
  timeRange?: DateRange,
  includeAdjacentTopics?: boolean
}

// Pattern insights endpoint
GET /api/youtube/patterns/:topicId
Response: {
  topFormats: FormatPerformance[],
  emergingFormats: FormatTrend[],
  crossNicheOpportunities: Opportunity[],
  saturationWarnings: string[]
}
```

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Create topic hierarchy from BERT clusters
- [ ] Implement format detection rules
- [ ] Build Level 1 classification pipeline
- [ ] Backfill existing 57k videos

### Phase 2: Interface (Week 3-4)
- [ ] Add new tab to YouTube Dashboard
- [ ] Implement search/filter UI
- [ ] Create performance visualization
- [ ] Build insight panels

### Phase 3: Intelligence (Week 5-6)
- [ ] Set up Level 2 pattern extraction
- [ ] Create cross-niche discovery algorithm
- [ ] Implement emerging pattern detection
- [ ] Add export functionality

### Phase 4: Enhancement (Week 7-8)
- [ ] Level 3 deep analysis integration
- [ ] Performance prediction models
- [ ] Saturation indicators
- [ ] A/B test insights

## Success Metrics

**Usage Metrics:**
- Daily active users on discovery tab
- Searches per user session
- Cross-niche exploration rate

**Quality Metrics:**
- Classification accuracy (manual spot checks)
- Pattern relevance (user feedback)
- Insight actionability scores

**Business Impact:**
- Videos created using insights
- Performance improvement of informed videos
- User retention/engagement

## Constraints & Considerations

**Technical:**
- Must handle 1M videos within a month
- Classification must be real-time on import
- No LLM calls for Level 1 (cost control)

**Product:**
- Maintain simplicity - creators aren't data scientists
- Insights must be actionable, not just interesting
- Respect existing dashboard patterns

**Scale:**
- Design for 10x current video count
- Pattern refresh can be async/batched
- Cache aggressively for common queries

## Future Opportunities

1. **Thumbnail Visual Patterns** - Leverage existing CLIP embeddings
2. **Predictive Performance** - "This format likely to get X views"
3. **Personalized Recommendations** - Based on creator's style
4. **Collaborative Filtering** - "Creators like you found success with..."
5. **API Access** - Enable automated content planning tools

## Appendix: Example User Journey

**Sarah runs a laser cutting channel:**

1. Opens YouTube Dashboard → Discovery tab
2. Searches "laser cutting beginner"
3. Sees her niche averages 50k views for tutorials
4. Notices "Tier List" format crushing it in adjacent "3D Printing" 
5. Filters to see all "Tier List" videos across Making topics
6. Discovers they average 3x performance but only 2 exist in laser cutting
7. Views pattern insights: "Tier lists work best with 5-7 items, controversial rankings"
8. Plans video: "Ranking 7 Laser Cutters: My Controversial Tier List"
9. Video performs 4x her channel average

This system transforms content planning from guesswork to data-driven strategy while maintaining creative freedom.