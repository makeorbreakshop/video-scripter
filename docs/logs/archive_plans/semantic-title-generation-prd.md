# Semantic Title Generation Tool - Product Requirements Document

## Executive Summary

A pre-production tool that helps YouTube creators optimize their video concepts through evidence-based title generation. The system analyzes patterns from 100K+ videos to suggest titles that work in specific semantic contexts, backed by real performance data.

**Core Value Proposition**: "The power of 100K+ video insights, laser-focused on what works for your content"

## Problem Statement

Current YouTube optimization tools provide generic advice that doesn't account for context. What works for historical cooking videos is completely different from modern recipe videos. Creators need:

- Context-specific insights for their exact type of content
- Evidence-based recommendations, not generic best practices
- Pre-production validation to avoid wasting time on videos that won't perform
- Understanding of WHY certain patterns work in their niche

## Target Users

### Primary Audience
- **Individual creators and small teams** who treat YouTube as a business
- **Already monetized** - can afford premium tools
- **Use case**: Pre-production concept validation and title optimization
- **Current alternatives**: Manual research, generic tools (VidIQ/TubeBuddy), gut instinct

### User Journey
1. Creator has video concept idea
2. Inputs concept into tool
3. Receives title suggestions based on semantic patterns
4. Sees evidence/examples backing each suggestion
5. Iterates on suggestions to find optimal title
6. Creates video with confidence in title choice

## Core Features

### 1. Concept Input → Title Generation
- **Input**: Natural language concept (e.g., "beginner woodworking mistakes")
- **Process**: 
  - Embed concept using OpenAI
  - Find nearest semantic neighborhood via cosine similarity
  - Match patterns that work in that neighborhood
- **Output**: 3-5 title suggestions with templates

### 2. Evidence-Based Recommendations
- Each suggestion shows:
  - Performance metrics ("This format performs 5.1x better")
  - Real examples from similar videos
  - Sample size for statistical confidence
  - WHY it works (LLM-generated explanation)

### 3. Pattern Discovery Engine
- **Semantic neighborhoods**: Groups of videos with similar title embeddings
- **Pattern types**:
  - Title templates: "[NUMBER] [ACTION] for [CONTEXT]"
  - Structure patterns: Questions, lists, emotional hooks
  - N-gram patterns: "mistakes I made", "why X is actually Y"
- **Dynamic updates**: Patterns evolve as new videos are imported daily

### 4. Iteration Tools
- Modify suggestions based on patterns
- Generate variations of successful templates
- Store/compare multiple title options
- (Future: A/B test prediction)

## Technical Architecture

### Current State
- ✅ 100K+ videos with title embeddings (512D OpenAI)
- ✅ Semantic pattern discovery using Pinecone
- ✅ LLM validation via Claude 3.5 Sonnet
- ✅ Daily import of thousands of new videos
- ❌ Patterns limited by BERT topic clusters
- ❌ Current patterns too channel-specific

### Required Changes (24-48 Hour Implementation)

#### 1. Pattern Discovery Improvements
```typescript
// Remove BERT filter, run on ALL videos
const seedVideos = await getHighPerformingVideos({
  min_performance: 1.5,
  across_all_topics: true,
  limit: 1000
});

// Better pattern analyzers
const analyzers = [
  TitleTemplateAnalyzer,    // "[X] ways to [Y]"
  NGramPatternAnalyzer,     // "mistakes I made"
  StructureAnalyzer,        // questions, lists
  EmotionalHookAnalyzer     // "why X is actually Y"
];
```

#### 2. Concept → Neighborhood Matching
```typescript
async function matchConceptToPatterns(concept: string) {
  // 1. Embed the concept
  const conceptEmbedding = await openai.createEmbedding(concept);
  
  // 2. Find nearest neighborhoods
  const neighborhoods = await findNearestNeighborhoods(conceptEmbedding, {
    topK: 3,
    minSimilarity: 0.7
  });
  
  // 3. Get patterns from those neighborhoods
  const patterns = await getPatternsForNeighborhoods(neighborhoods);
  
  // 4. Generate titles using patterns
  return generateTitlesFromPatterns(patterns, concept);
}
```

#### 3. Title Generation Pipeline
```typescript
interface TitleSuggestion {
  title: string;
  pattern: {
    template: string;
    performance_lift: number;
    examples: Video[];
  };
  evidence: {
    sample_size: number;
    avg_views: number;
    confidence_score: number;
  };
  explanation: string; // Why this works
}
```

### Data Flow
1. **Pattern Discovery** (runs continuously)
   - Analyze high-performing videos
   - Extract title patterns within semantic neighborhoods
   - Validate with LLM
   - Store patterns with centroid embeddings

2. **Title Generation** (real-time)
   - User inputs concept
   - Find matching neighborhoods
   - Apply patterns to generate titles
   - Return with evidence

## Competitive Analysis

### Existing Tools
- **1of10**: Shows generic frameworks from top creators
- **ViewStats**: Tracks performance after publish
- **VidIQ/TubeBuddy**: Broad best practices, keyword focus
- **Our Advantage**: Context-specific patterns with performance prediction

### Unique Differentiators
1. **Semantic understanding** - Patterns work differently in different content spaces
2. **Evidence-based** - Every suggestion backed by real data
3. **Pre-production focus** - Validate before creating
4. **Pattern evolution** - Tracks emerging vs saturating trends

## Success Metrics

### Immediate (24-48 hours)
- [ ] Pattern discovery finds 50+ useful title patterns
- [ ] Tool generates relevant titles for test concepts
- [ ] Personal use saves time in title creation

### Week 1
- [ ] 2-3 paying customers find clear value
- [ ] Patterns cover major content categories
- [ ] Title suggestions feel creative, not generic

### Month 1
- [ ] 20+ active users
- [ ] 80% of suggested titles outperform user baseline
- [ ] Strong testimonials about discovering new angles

## Monetization Strategy

### Premium SaaS Model
- **Target Price**: $99-199/month
- **Annual Discount**: 20% (2 months free)
- **Value Justification**: One improved video pays for months of subscription

### Future Tiers
- **Starter**: Limited patterns/searches
- **Pro**: Full access + prediction scores
- **Team**: Multi-channel management

## Implementation Timeline

### Day 1 (Today)
1. **Morning**: Update pattern discovery
   - Remove BERT filter
   - Add better title analyzers
   - Run on full database
   
2. **Afternoon**: Build matching pipeline
   - Concept → embedding → neighborhood
   - Pattern application
   - Basic UI for testing

### Day 2 (Tomorrow)
1. **Morning**: Refine patterns
   - Filter for quality
   - Group related patterns
   - Generate explanations
   
2. **Afternoon**: Test with real concepts
   - Personal content ideas
   - Common creator scenarios
   - Iterate on output quality

### Week 1
- Polish UI/UX
- Add evidence display
- Onboard 2-3 beta users
- Gather feedback
- Implement improvements

## Risk Mitigation

### Technical Risks
- **Pattern quality**: Start with high thresholds, loosen based on results
- **Matching accuracy**: Show confidence scores, allow browsing patterns
- **Performance**: Cache common concepts, pre-compute neighborhoods

### Business Risks
- **Adoption**: Start with personal network, get testimonials
- **Differentiation**: Focus on evidence/examples competitors lack
- **Pricing**: Test with small group before public launch

## Future Roadmap

### Phase 2: Performance Prediction
- Predict view counts for generated titles
- A/B test recommendations
- Track prediction accuracy

### Phase 3: Multi-Modal
- Thumbnail pattern analysis
- Title + thumbnail combinations
- Complete pre-production package

### Phase 4: Automation
- API for bulk generation
- Integration with publishing tools
- Automated optimization suggestions

## Conclusion

This tool transforms YouTube title creation from guesswork to data-driven decisions. By focusing on semantic context and real evidence, we provide insights that generic tools cannot match. The 24-48 hour implementation focuses on core functionality that can immediately provide value while setting the foundation for a scalable SaaS product.