# Optimized Pattern Discovery Process

## Core Principles
✅ Keep gathering lots of videos (maintain 2,000+ for diversity)  
✅ Batch pattern analysis for efficiency  
✅ Maintain high-quality pattern discovery  
✅ Reduce redundancy without losing insights  

## Recommended Process Architecture

### Phase 1: Video Collection (Keep Current)
```typescript
// KEEP THIS AS IS - It's working well!
// 78 queries × 500 videos = Up to 39,000 potential videos
// After deduplication: ~2,000-3,000 unique videos
// This gives us excellent coverage
```

**Why this works:**
- Diverse search angles find unexpected patterns
- Large sample size ensures statistical significance
- Current 18s search time is acceptable

### Phase 2: Smart Clustering (Optimize)
```typescript
// Current: Process all clusters
// Optimized: Intelligent cluster filtering

interface ClusterQualityMetrics {
  size: number;
  avgPerformance: number;
  threadDiversity: number;
  contentCoherence: number;
}

function selectHighValueClusters(clusters: Cluster[]): Cluster[] {
  return clusters
    .map(cluster => ({
      ...cluster,
      quality: calculateClusterQuality(cluster)
    }))
    .sort((a, b) => b.quality - a.quality)
    .slice(0, 20); // Focus on top 20 clusters
}

function calculateClusterQuality(cluster: Cluster): number {
  const sizeScore = Math.min(cluster.size / 10, 1); // Favor 10+ videos
  const performanceScore = cluster.avgPerformance / 5; // Normalize to 0-1
  const diversityScore = cluster.threadSources.length / 8; // Thread variety
  const coherenceScore = cluster.tightness; // From DBSCAN
  
  return (sizeScore * 0.3) + 
         (performanceScore * 0.3) + 
         (diversityScore * 0.2) + 
         (coherenceScore * 0.2);
}
```

### Phase 3: Batched Pattern Analysis (New)
```typescript
async function analyzePatternsBatched(
  clusters: ClusterWithVideos[],
  concept: string,
  batchSize: number = 5
): Promise<DiscoveredPattern[]> {
  
  // Group clusters intelligently
  const batches = createSmartBatches(clusters, batchSize);
  
  const batchPrompts = batches.map((batch, batchIndex) => ({
    messages: [{
      role: "system",
      content: `You are analyzing YouTube video clusters to find high-performing title patterns.
                Find 3-5 patterns per cluster that consistently outperform baseline.
                Return structured JSON with patterns.`
    }, {
      role: "user",
      content: formatBatchedClusterAnalysis(batch, concept, batchIndex)
    }],
    response_format: PatternBatchSchema
  }));
  
  // Process all batches in parallel
  const results = await Promise.all(
    batchPrompts.map(prompt => 
      openai.beta.chat.completions.parse({
        model: "gpt-4o-mini",
        ...prompt,
        temperature: 0.7,
        max_tokens: 2000 // Limit output per batch
      })
    )
  );
  
  return extractAndValidatePatterns(results);
}

function formatBatchedClusterAnalysis(
  batch: ClusterWithVideos[],
  concept: string,
  batchIndex: number
): string {
  return `
Analyze these ${batch.length} video clusters for "${concept}":

${batch.map((cluster, idx) => `
CLUSTER ${batchIndex * 5 + idx + 1} [${cluster.is_wide ? 'WIDE' : 'DEEP'}]
Thread sources: ${cluster.thread_sources.join(', ')}
Cluster size: ${cluster.size} videos
Avg performance: ${cluster.avg_performance.toFixed(1)}x baseline

Top performing videos:
${cluster.videos
  .sort((a, b) => b.performance_ratio - a.performance_ratio)
  .slice(0, 8) // Slightly fewer videos per cluster
  .map(v => `- "${v.title}" (${v.performance_ratio.toFixed(1)}x, ${v.channel_name})`)
  .join('\n')}
`).join('\n---\n')}

Identify 3-5 title patterns per cluster that appear multiple times with >3x performance.
Focus on patterns that would work for new videos about "${concept}".
`.trim();
}
```

### Phase 4: Enhanced Pattern Validation
```typescript
interface EnhancedPattern {
  pattern: DiscoveredPattern;
  validation: {
    videoCount: number;
    avgPerformance: number;
    consistency: number; // How consistent is performance
    crossThreadValidation: boolean;
    exampleSpread: number; // Diversity of channels using it
  };
}

function validatePatterns(
  patterns: DiscoveredPattern[],
  sourceVideos: VideoWithMetadata[]
): EnhancedPattern[] {
  return patterns.map(pattern => {
    const matchingVideos = findMatchingVideos(pattern, sourceVideos);
    
    return {
      pattern,
      validation: {
        videoCount: matchingVideos.length,
        avgPerformance: average(matchingVideos.map(v => v.performance_ratio)),
        consistency: calculateConsistency(matchingVideos),
        crossThreadValidation: pattern.thread_count >= 3,
        exampleSpread: new Set(matchingVideos.map(v => v.channel_id)).size
      }
    };
  }).filter(p => p.validation.videoCount >= 3); // Require 3+ examples
}
```

## Optimized Settings Recommendations

### 1. Thread Expansion (Keep Rich)
```typescript
const threadConfig = {
  numThreads: 15, // Keep diverse angles
  queriesPerThread: 5, // Reduced from 6
  totalQueries: 75, // Similar to current
  model: "gpt-4o-mini",
  temperature: 0.8 // Creativity for diverse angles
};
```

### 2. Video Search (Keep Broad)
```typescript
const searchConfig = {
  videosPerQuery: 300, // Reduced from 500 but still substantial
  minScore: 0.35,
  includeEmbeddings: true,
  deduplication: "keep-highest-score"
};
```

### 3. Clustering (Optimize)
```typescript
const clusterConfig = {
  method: "DBSCAN",
  epsilon: 0.12, // Tighter clusters (was 0.15)
  minPoints: 4, // Require more videos (was 3)
  maxClusters: 20, // Focus on best clusters
  minClusterQuality: 0.6 // Quality threshold
};
```

### 4. Pattern Discovery (Batch)
```typescript
const patternConfig = {
  batchSize: 5, // Clusters per API call
  patternsPerCluster: "3-5",
  minPerformance: 3.0,
  minConfidence: 0.7,
  maxTokensPerBatch: 2000,
  temperature: 0.7
};
```

## Expected Improvements

### Performance
- **Video Collection**: 18s (unchanged)
- **Clustering**: 0.5s (slightly longer due to quality scoring)
- **Pattern Discovery**: 12s (was 30s) - 60% faster
- **Total**: ~40s (was 77s) - 48% faster

### Cost
- **Thread Expansion**: $0.001 (similar)
- **Pattern Discovery**: $0.009 (was $0.022) - 59% cheaper
- **Total**: ~$0.010 (was $0.024) - 58% cheaper

### Quality
- **Pattern Precision**: Higher (better cluster quality)
- **Pattern Validation**: Stronger (enhanced validation)
- **False Positives**: Lower (tighter clustering)
- **Coverage**: Maintained (still analyzing 2000+ videos)

## Implementation Priority

1. **Week 1**: Implement batched pattern discovery
   - Immediate 60% cost reduction
   - 50% speed improvement
   - No quality loss

2. **Week 2**: Add cluster quality scoring
   - Better pattern precision
   - Reduce noise in results
   - Focus compute on high-value clusters

3. **Week 3**: Enhanced validation pipeline
   - Stronger confidence in patterns
   - Better filtering of edge cases
   - Richer metadata for users

4. **Week 4**: Caching layer
   - 90% of common searches instant
   - Dramatic cost reduction at scale
   - Better user experience

## Code Example: Complete Optimized Flow

```typescript
async function generateTitlesOptimized(concept: string) {
  // 1. Expand threads (keep current approach)
  const threads = await expandThreadsWithLLM(concept, {
    numThreads: 15,
    queriesPerThread: 5
  });
  
  // 2. Search videos (keep current approach)
  const videos = await searchVideosInParallel(threads, {
    videosPerQuery: 300,
    minScore: 0.35
  });
  
  // 3. Smart clustering with quality scoring
  const allClusters = await clusterVideosByContent(videos, {
    epsilon: 0.12,
    minPoints: 4
  });
  
  const highQualityClusters = selectHighValueClusters(allClusters)
    .slice(0, 20); // Top 20 clusters
  
  // 4. Batched pattern discovery
  const patterns = await analyzePatternsBatched(
    highQualityClusters,
    concept,
    5 // 5 clusters per batch = 4 API calls for 20 clusters
  );
  
  // 5. Enhanced validation
  const validatedPatterns = validatePatterns(patterns, videos);
  
  // 6. Generate final suggestions
  return formatTitleSuggestions(validatedPatterns, concept);
}
```

This approach maintains the quality you want while being much more efficient!