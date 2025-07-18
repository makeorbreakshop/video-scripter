# Dynamic Batching Strategy for Pattern Discovery

## Core Concept
Dynamically adjust batching based on:
- Number of clusters found
- Cluster quality distribution  
- Token complexity per cluster
- Time/cost constraints

## Dynamic Batching Algorithm

```typescript
interface DynamicBatchingConfig {
  minBatchSize: number;        // Minimum clusters per batch (e.g., 3)
  maxBatchSize: number;        // Maximum clusters per batch (e.g., 8)
  targetTokensPerBatch: number; // Aim for ~3000-4000 tokens per call
  maxTotalCalls: number;       // Budget constraint (e.g., 10 calls max)
  qualityThreshold: number;    // Min quality score to process
}

async function createDynamicBatches(
  clusters: ClusterWithVideos[],
  config: DynamicBatchingConfig = {
    minBatchSize: 3,
    maxBatchSize: 8,
    targetTokensPerBatch: 3500,
    maxTotalCalls: 10,
    qualityThreshold: 0.5
  }
): Promise<ClusterBatch[]> {
  
  // Step 1: Score and filter clusters
  const scoredClusters = clusters
    .map(cluster => ({
      ...cluster,
      quality: calculateClusterQuality(cluster),
      estimatedTokens: estimateTokensForCluster(cluster),
      priority: calculatePriority(cluster)
    }))
    .filter(c => c.quality >= config.qualityThreshold)
    .sort((a, b) => b.priority - a.priority);

  // Step 2: Determine optimal strategy
  const strategy = determineStrategy(scoredClusters);
  
  // Step 3: Create batches based on strategy
  return createBatchesWithStrategy(scoredClusters, strategy, config);
}

// Calculate how many tokens a cluster will need
function estimateTokensForCluster(cluster: ClusterWithVideos): number {
  const baseTokens = 200; // Instructions per cluster
  const perVideoTokens = 25; // Tokens per video title
  const videosToInclude = Math.min(cluster.size, 8); // Cap at 8 videos
  
  return baseTokens + (videosToInclude * perVideoTokens);
}

// Determine batching strategy based on data characteristics
function determineStrategy(clusters: ScoredCluster[]): BatchingStrategy {
  const totalClusters = clusters.length;
  const totalTokens = clusters.reduce((sum, c) => sum + c.estimatedTokens, 0);
  const avgTokensPerCluster = totalTokens / totalClusters;
  const highQualityClusters = clusters.filter(c => c.quality > 0.8).length;
  
  // Few high-quality clusters: Process thoroughly
  if (totalClusters <= 10) {
    return {
      type: 'THOROUGH',
      batchSize: 3, // Smaller batches for detailed analysis
      videosPerCluster: 10,
      patternsPerCluster: '5-8'
    };
  }
  
  // Many clusters with mixed quality: Adaptive batching
  if (totalClusters > 20 && highQualityClusters < 10) {
    return {
      type: 'ADAPTIVE',
      batchSize: 'dynamic', // Vary based on token count
      videosPerCluster: 6,
      patternsPerCluster: '3-5'
    };
  }
  
  // Many high-quality clusters: Efficient processing
  if (totalClusters > 20 && highQualityClusters >= 10) {
    return {
      type: 'EFFICIENT',
      batchSize: 6, // Larger batches
      videosPerCluster: 5,
      patternsPerCluster: '3-4'
    };
  }
  
  // Default: Balanced approach
  return {
    type: 'BALANCED',
    batchSize: 5,
    videosPerCluster: 8,
    patternsPerCluster: '4-6'
  };
}

// Create batches with token-aware grouping
function createBatchesWithStrategy(
  clusters: ScoredCluster[],
  strategy: BatchingStrategy,
  config: DynamicBatchingConfig
): ClusterBatch[] {
  const batches: ClusterBatch[] = [];
  let currentBatch: ScoredCluster[] = [];
  let currentTokens = 0;
  
  for (const cluster of clusters) {
    const clusterTokens = cluster.estimatedTokens;
    
    // Check if adding this cluster would exceed limits
    const wouldExceedTokens = currentTokens + clusterTokens > config.targetTokensPerBatch;
    const wouldExceedSize = currentBatch.length >= (
      strategy.batchSize === 'dynamic' 
        ? config.maxBatchSize 
        : strategy.batchSize
    );
    
    // Start new batch if needed
    if (currentBatch.length > 0 && (wouldExceedTokens || wouldExceedSize)) {
      // Only create batch if it meets minimum size
      if (currentBatch.length >= config.minBatchSize) {
        batches.push(createBatch(currentBatch, strategy));
      } else if (batches.length > 0) {
        // Add to previous batch if too small
        const lastBatch = batches[batches.length - 1];
        lastBatch.clusters.push(...currentBatch);
      }
      
      currentBatch = [];
      currentTokens = 0;
    }
    
    currentBatch.push(cluster);
    currentTokens += clusterTokens;
    
    // Stop if we've hit our call budget
    if (batches.length >= config.maxTotalCalls - 1) {
      break;
    }
  }
  
  // Handle remaining clusters
  if (currentBatch.length > 0) {
    if (currentBatch.length >= config.minBatchSize || batches.length === 0) {
      batches.push(createBatch(currentBatch, strategy));
    } else if (batches.length > 0) {
      // Merge with last batch
      batches[batches.length - 1].clusters.push(...currentBatch);
    }
  }
  
  return optimizeBatches(batches, config);
}

// Optimize batches for balanced processing
function optimizeBatches(
  batches: ClusterBatch[],
  config: DynamicBatchingConfig
): ClusterBatch[] {
  // Rebalance if we have very uneven batches
  const avgSize = batches.reduce((sum, b) => sum + b.clusters.length, 0) / batches.length;
  const needsRebalancing = batches.some(b => 
    b.clusters.length > avgSize * 1.5 || 
    b.clusters.length < avgSize * 0.5
  );
  
  if (needsRebalancing && batches.length > 2) {
    return rebalanceBatches(batches, config);
  }
  
  return batches;
}
```

## Dynamic Quality Scoring

```typescript
function calculateClusterQuality(cluster: ClusterWithVideos): number {
  // Size factor (optimal: 10-30 videos)
  const sizeFactor = cluster.size <= 10 
    ? cluster.size / 10 
    : cluster.size <= 30 
      ? 1.0 
      : Math.max(0.7, 1 - (cluster.size - 30) / 100);
  
  // Performance factor
  const performanceFactor = Math.min(cluster.avg_performance / 5, 1);
  
  // Thread diversity (WIDE patterns valued higher)
  const diversityFactor = Math.min(cluster.thread_sources.length / 5, 1);
  
  // Performance consistency
  const performances = cluster.videos.map(v => v.performance_ratio);
  const avgPerf = average(performances);
  const stdDev = standardDeviation(performances);
  const consistencyFactor = 1 - Math.min(stdDev / avgPerf, 0.5);
  
  return (
    sizeFactor * 0.25 +
    performanceFactor * 0.35 +
    diversityFactor * 0.25 +
    consistencyFactor * 0.15
  );
}

function calculatePriority(cluster: ScoredCluster): number {
  // Prioritize WIDE patterns
  const widePriority = cluster.is_wide ? 1.5 : 1.0;
  
  // Boost very high performing clusters
  const performanceBoost = cluster.avg_performance > 4 ? 1.3 : 1.0;
  
  return cluster.quality * widePriority * performanceBoost;
}
```

## Adaptive Token Management

```typescript
async function processWithAdaptiveTokens(
  batch: ClusterBatch,
  concept: string
): Promise<PatternResponse> {
  const prompt = buildAdaptivePrompt(batch, concept);
  
  // Dynamically set max tokens based on batch complexity
  const baseTokensPerCluster = 300;
  const maxTokens = Math.min(
    batch.clusters.length * baseTokensPerCluster,
    4000 // Hard cap
  );
  
  return await openai.beta.chat.completions.parse({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: getSystemPrompt(batch.strategy)
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: batch.strategy.type === 'THOROUGH' ? 0.8 : 0.7,
    max_tokens: maxTokens,
    response_format: { type: "json_object" }
  });
}

function buildAdaptivePrompt(batch: ClusterBatch, concept: string): string {
  const { strategy, clusters } = batch;
  
  return `
Analyze ${clusters.length} video clusters for "${concept}":
Strategy: ${strategy.type} (${strategy.patternsPerCluster} patterns per cluster)

${clusters.map((cluster, idx) => {
  const videosToShow = Math.min(
    cluster.size,
    strategy.videosPerCluster || 8
  );
  
  return `
CLUSTER ${idx + 1} [${cluster.is_wide ? 'WIDE' : 'DEEP'}] - Quality: ${(cluster.quality * 100).toFixed(0)}%
Sources: ${cluster.thread_sources.slice(0, 5).join(', ')}${cluster.thread_sources.length > 5 ? '...' : ''}
Size: ${cluster.size} videos | Avg: ${cluster.avg_performance.toFixed(1)}x

Top performers:
${cluster.videos
  .slice(0, videosToShow)
  .map(v => `- "${v.title}" (${v.performance_ratio.toFixed(1)}x)`)
  .join('\n')}
`;
}).join('\n---\n')}

Identify ${strategy.patternsPerCluster} title patterns per cluster.
${strategy.type === 'THOROUGH' ? 'Provide detailed analysis with multiple examples.' : ''}
${strategy.type === 'EFFICIENT' ? 'Focus on the most obvious patterns only.' : ''}
`.trim();
}
```

## Usage Example

```typescript
async function generateTitlesWithDynamicBatching(concept: string) {
  // ... (video collection and clustering as before)
  
  // Dynamically determine batching strategy
  const batches = await createDynamicBatches(clusters, {
    minBatchSize: 3,
    maxBatchSize: 8,
    targetTokensPerBatch: 3500,
    maxTotalCalls: Math.ceil(clusters.length / 5), // Flexible budget
    qualityThreshold: 0.5
  });
  
  console.log(`📊 Dynamic batching strategy:
    - Total clusters: ${clusters.length}
    - Quality clusters: ${batches.reduce((sum, b) => sum + b.clusters.length, 0)}
    - Batches created: ${batches.length}
    - Strategy: ${batches[0]?.strategy.type || 'NONE'}
    - Avg clusters/batch: ${(batches.reduce((sum, b) => sum + b.clusters.length, 0) / batches.length).toFixed(1)}
  `);
  
  // Process batches in parallel
  const patternResults = await Promise.all(
    batches.map(batch => processWithAdaptiveTokens(batch, concept))
  );
  
  return consolidatePatterns(patternResults);
}
```

## Benefits of Dynamic Batching

1. **Efficiency**: Automatically adjusts to data characteristics
2. **Quality**: More thorough analysis when fewer clusters
3. **Cost Control**: Respects token and API call budgets
4. **Flexibility**: Handles edge cases gracefully
5. **Optimization**: Balances batches for even processing

## Expected Outcomes

### Scenario 1: Few High-Quality Clusters (8 clusters)
- Strategy: THOROUGH
- Batches: 3 (3, 3, 2 clusters)
- Tokens/batch: ~2500
- Result: Deep analysis, 5-8 patterns per cluster

### Scenario 2: Many Mixed Clusters (35 clusters)
- Strategy: ADAPTIVE
- Batches: 6 (5-6 clusters each)
- Tokens/batch: ~3500
- Result: Balanced analysis, 3-5 patterns per cluster

### Scenario 3: Many High-Quality Clusters (25 clusters)
- Strategy: EFFICIENT
- Batches: 4 (6-7 clusters each)
- Tokens/batch: ~3000
- Result: Quick extraction, 3-4 patterns per cluster

This dynamic approach ensures optimal processing regardless of input variety!