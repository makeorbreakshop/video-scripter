# Title Generation Performance Optimization Plan

## Current Performance: 77.2 seconds
Target Performance: <20 seconds

## Bottleneck Analysis

### 1. Pattern Discovery (30.5s - 39.5%) 🔴
**Issue**: Making 31 separate Claude API calls sequentially within Promise.all
**Solutions**:
- **Batch multiple clusters per API call** - Send 5-10 clusters to Claude at once
- **Use GPT-4o-mini for initial pattern discovery** (10x faster, 100x cheaper)
- **Cache common patterns** by concept similarity
- **Implement streaming responses** to show patterns as they're discovered

### 2. LLM Thread Expansion (25.9s - 33.5%) 🔴
**Issue**: Complex prompt requiring deep reasoning for 78 queries
**Solutions**:
- **Pre-compute thread templates** for common concepts
- **Use embedding similarity** to find cached thread expansions
- **Reduce to 10-12 threads** with 3-4 queries each (36-48 total vs 78)
- **Use GPT-3.5-turbo** for thread expansion (faster, sufficient quality)

### 3. Pinecone Search (18.1s - 23.4%) 🟡
**Issue**: 78 separate API calls even with Promise.all
**Solutions**:
- **Implement Pinecone batch search** (single API call for all queries)
- **Cache frequent search results** with 1-hour TTL
- **Reduce search space** with metadata filtering
- **Lower topK** from 500 to 200 per query

## Implementation Plan

### Quick Wins (1-2 days)
1. **Reduce thread expansion**
   ```typescript
   // Current: 78 queries
   const threads = await expandThreadsWithLLM(concept); // 25.9s
   
   // Optimized: 36 queries
   const threads = await expandThreadsOptimized(concept, {
     maxThreads: 12,
     queriesPerThread: 3,
     model: 'gpt-3.5-turbo'
   }); // Target: 5s
   ```

2. **Batch pattern discovery**
   ```typescript
   // Current: 31 separate Claude calls
   const patterns = await Promise.all(clusters.map(discoverPatterns));
   
   // Optimized: 6 batched calls (5 clusters each)
   const patterns = await discoverPatternsInBatches(clusters, {
     batchSize: 5,
     model: 'gpt-4o-mini'
   }); // Target: 10s
   ```

3. **Optimize Pinecone queries**
   ```typescript
   // Current: 78 queries × 500 results
   const results = await Promise.all(embeddings.map(search));
   
   // Optimized: Batch search with reduced topK
   const results = await pinecone.batchSearch({
     embeddings,
     topK: 200,
     filter: { published_after: '2023-01-01' }
   }); // Target: 5s
   ```

### Medium-term (1 week)
1. **Redis caching layer**
   - Cache embeddings for common concepts
   - Cache search results with 1-hour TTL
   - Cache discovered patterns by concept similarity

2. **Response streaming**
   - Stream patterns as they're discovered
   - Show progress indicators for each stage
   - Implement Server-Sent Events (SSE)

3. **Smart thread reduction**
   - Use BERT to cluster similar queries
   - Remove redundant search angles
   - Focus on high-yield thread types

### Long-term (2-4 weeks)
1. **Pre-computed pattern database**
   - Daily batch process to discover patterns
   - Store patterns with concept embeddings
   - Instant retrieval for similar concepts

2. **Distributed processing**
   - Use Vercel Edge Functions for parallel processing
   - Implement job queue with BullMQ
   - Horizontal scaling for high load

3. **ML-based optimization**
   - Train model to predict best threads for concepts
   - Learn optimal cluster sizes
   - Predict pattern performance without full analysis

## Expected Results

### Phase 1 (Quick Wins)
- **Current**: 77.2s
- **Target**: 25s
- **Reduction**: 67% faster

### Phase 2 (With Caching)
- **First request**: 25s
- **Cached requests**: 5-10s
- **Average**: 12s (85% faster)

### Phase 3 (Full Optimization)
- **Pre-computed**: <2s
- **New concepts**: 15s
- **Average**: 5s (93% faster)

## Code Example: Batched Pattern Discovery

```typescript
async function discoverPatternsInBatches(
  clusters: ClusterWithVideos[],
  options: { batchSize: number; model: string }
): Promise<DiscoveredPattern[]> {
  const batches = [];
  
  // Group clusters into batches
  for (let i = 0; i < clusters.length; i += options.batchSize) {
    batches.push(clusters.slice(i, i + options.batchSize));
  }
  
  // Process batches in parallel
  const batchPromises = batches.map(async (batch) => {
    const combinedPrompt = batch.map((cluster, idx) => `
      CLUSTER ${idx + 1} (${cluster.is_wide ? 'WIDE' : 'DEEP'}):
      Videos: ${cluster.videos.length}
      Threads: ${cluster.thread_sources.join(', ')}
      
      Top videos:
      ${cluster.videos.slice(0, 10).map(v => `- "${v.title}"`).join('\n')}
    `).join('\n\n---\n\n');
    
    // Single API call for multiple clusters
    return await discoverPatternsWithOpenAI(combinedPrompt, options.model);
  });
  
  const batchResults = await Promise.all(batchPromises);
  return batchResults.flat();
}
```

## Monitoring & Metrics

Track these KPIs:
- P50, P90, P99 response times
- Cache hit rates
- API costs per request
- User satisfaction (completion rate)
- Pattern quality scores

## Next Steps

1. Implement thread reduction (biggest quick win)
2. Add batched pattern discovery
3. Set up Redis caching
4. Monitor improvements
5. Iterate based on metrics