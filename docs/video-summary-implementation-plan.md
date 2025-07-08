# Video Summary & Categorization Implementation Plan

## Overview
Implement a cost-effective system to generate searchable summaries for 50,000+ videos, scaling to 1M+.

## Current State
- 50,687 total videos
- Only 277 have transcript chunks
- Title/thumbnail vectors exist but lack semantic depth

## Proposed Architecture

### 1. Cost-Effective Transcript Acquisition
```
Phase 1: YouTube API (Free Tier)
- Use youtube-transcript-api for captions
- Batch process 10k videos/day
- Cost: $0 (within API limits)

Phase 2: Fallback for missing transcripts
- Use Whisper API for videos without captions
- Cost: ~$0.006/minute of audio
```

### 2. Summary Generation Pipeline

#### Option A: Direct Summarization (Higher Quality, Higher Cost)
```
Input: Full transcript
Model: GPT-3.5-turbo or Claude Haiku
Prompt: Generate 150-word summary + extract hook
Cost: ~$0.002/video = $100 for 50k videos
```

#### Option B: Chunk-Based Summarization (Lower Cost)
```
1. Use existing chunking system
2. Generate embeddings for chunks
3. Select top 3-5 most representative chunks
4. Summarize only those chunks
Cost: ~$0.0005/video = $25 for 50k videos
```

#### Option C: Hybrid Approach (Recommended)
```
1. For top 20% performing videos: Full summarization
2. For remaining 80%: Chunk-based approach
3. Gradually upgrade summaries based on search frequency
Cost: ~$40 for initial 50k videos
```

### 3. Database Schema

```sql
-- New table for video summaries and categorization
CREATE TABLE video_summaries (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    hook TEXT,
    summary_embedding vector(1536),
    categories JSONB DEFAULT '[]',
    content_themes TEXT[],
    summary_version VARCHAR(10) DEFAULT '1.0',
    generated_at TIMESTAMP DEFAULT NOW(),
    last_accessed TIMESTAMP,
    access_count INTEGER DEFAULT 0,
    
    UNIQUE(video_id)
);

-- Index for vector similarity search
CREATE INDEX video_summaries_embedding_idx ON video_summaries 
USING ivfflat (summary_embedding vector_cosine_ops)
WITH (lists = 100);

-- Index for performance tracking
CREATE INDEX video_summaries_access_idx ON video_summaries(last_accessed, access_count);
```

### 4. Processing Pipeline

```typescript
// Batch processing with cost optimization
interface VideoSummaryJob {
  videoId: string;
  priority: 'high' | 'medium' | 'low';
  method: 'full' | 'chunk-based';
}

class VideoSummaryProcessor {
  async processVideo(job: VideoSummaryJob) {
    // 1. Get transcript (from chunks or YouTube API)
    const transcript = await this.getTranscript(job.videoId);
    
    // 2. Generate summary based on method
    const { summary, hook } = job.method === 'full' 
      ? await this.fullSummarization(transcript)
      : await this.chunkBasedSummarization(transcript);
    
    // 3. Generate embedding
    const embedding = await this.generateEmbedding(summary);
    
    // 4. Extract categories and themes
    const { categories, themes } = await this.categorizeContent(summary);
    
    // 5. Store in database
    await this.saveSummary({
      videoId: job.videoId,
      summary,
      hook,
      embedding,
      categories,
      themes
    });
  }
}
```

### 5. Hook Extraction System

```typescript
// Specialized prompt for hook extraction
const HOOK_EXTRACTION_PROMPT = `
Analyze this video transcript and identify:
1. The main hook (first 15-30 seconds) that grabs viewer attention
2. Key emotional triggers used
3. Promise or value proposition made

Return as JSON:
{
  "hook_text": "exact quote from opening",
  "hook_type": "question|story|statistic|promise|controversy",
  "emotional_triggers": ["curiosity", "fear", "excitement"],
  "value_proposition": "what viewer will gain"
}
`;
```

### 6. Search Enhancement

```typescript
// Enhanced video search with summaries
async function searchVideos(query: string, options: SearchOptions) {
  // 1. Generate query embedding
  const queryEmbedding = await generateEmbedding(query);
  
  // 2. Search across multiple vectors
  const results = await supabase.rpc('search_videos_enhanced', {
    query_embedding: queryEmbedding,
    title_weight: 0.3,
    thumbnail_weight: 0.2,
    summary_weight: 0.5,  // Highest weight on summary
    limit: options.limit
  });
  
  // 3. Track search patterns for optimization
  await trackSearchQuery(query, results);
  
  return results;
}
```

### 7. Categorization System

```typescript
// Dynamic category generation
const CATEGORY_THEMES = {
  content_type: ['tutorial', 'review', 'comparison', 'news', 'entertainment'],
  skill_level: ['beginner', 'intermediate', 'advanced'],
  format: ['how-to', 'listicle', 'case-study', 'vlog', 'documentary'],
  emotional_tone: ['educational', 'inspirational', 'controversial', 'humorous']
};

// Cluster videos by content similarity
async function clusterVideosByContent() {
  const embeddings = await getVideoSummaryEmbeddings();
  const clusters = await performKMeansClustering(embeddings, { 
    k: 50,  // Start with 50 clusters
    iterations: 100 
  });
  
  return analyzeClusters(clusters);
}
```

## Implementation Timeline

### Week 1-2: Infrastructure Setup
- Create database tables and indexes
- Set up transcript fetching pipeline
- Implement basic summarization

### Week 3-4: Processing Pipeline
- Build batch processing system
- Implement cost optimization logic
- Add monitoring and error handling

### Week 5-6: Search & Analytics
- Enhance search functionality
- Build categorization system
- Create analytics dashboard

## Cost Projections

### Initial Processing (50k videos)
- Transcript acquisition: ~$50 (for videos needing Whisper)
- Summarization: ~$40 (hybrid approach)
- Embeddings: ~$20
- **Total: ~$110**

### Ongoing Costs (per 1000 new videos)
- Processing: ~$2-3
- Storage: Minimal (text + vectors)
- Compute: Covered by existing infrastructure

### Scaling to 1M Videos
- Use progressive enhancement (process on-demand)
- Implement caching and CDN for popular summaries
- Consider self-hosted models for cost reduction at scale

## ROI Justification

1. **Enhanced Discovery**: Users find 3-5x more relevant videos
2. **Better Analytics**: Understand content gaps and opportunities
3. **Competitive Advantage**: Surface insights competitors miss
4. **Future Features**: Enable AI script suggestions based on successful patterns

## Next Steps

1. Review and approve approach
2. Set up test pipeline with 1000 videos
3. Evaluate quality and costs
4. Scale to full dataset