# YouTube API Optimization Analysis

## Current System - Complete API Flow for Single Channel Import

### Architecture Overview

The system uses a **job queue architecture** with background workers:

1. **API Endpoint** (`/api/video-import/unified`) - Receives import requests
2. **Job Queue** (Supabase `video_processing_jobs` table) - Stores pending work
3. **Background Workers** - Process jobs asynchronously
4. **Vector Workers** (optional) - Dedicated workers for embeddings

### Request Flow

#### Step 1: API Request
When a user imports a channel:
- Request hits `/api/video-import/unified`
- By default, creates a job and returns immediately (async)
- Optional: Can process synchronously with `useQueue: false`

#### Step 2: Job Creation
For async requests (default):
```json
{
  "video_id": "Channel: MrBeast (1,543 videos)",  // Human-readable name
  "source": "competitor",
  "status": "pending",
  "priority": 2,  // 1 for owner videos, 2 for others
  "metadata": {
    "channelIds": ["UC..."],
    "options": { "excludeShorts": true, "batchSize": 50 }
  }
}
```
**API returns immediately** with job ID and status URL.

#### Step 3: Worker Processing
Background worker:
- Polls every 30 seconds for pending jobs
- Claims job by setting status to "processing"
- Executes the complete import pipeline
- Updates job status to "completed" or "failed"

### Operations Performed by Worker

When the worker processes a channel import job, it performs:

1. **Fetch all video IDs** from the channel
2. **Get detailed metadata** for each video (including channel stats)
3. **Generate title embeddings** using OpenAI
4. **Generate thumbnail embeddings** using Replicate CLIP
5. **Store in database** (Supabase)
6. **Upload to vector databases** (Pinecone)
7. **Export local files** (JSON/CSV)

### Detailed API Call Breakdown

#### 1. YouTube API Calls

**A. Fetch Channel Videos (`fetchVideosFromChannels`)**
- **Endpoint**: `youtube/v3/playlistItems`
- **Purpose**: Get all video IDs from channel's uploads playlist
- **Pagination**: 50 videos per page
- **API Cost**: 1 unit per call
- **Example**: 1,000 videos = 20 API calls

**B. Fetch Video Details (`fetchVideoDetails`)**
- **Current Implementation**: 
  - Makes 1 API call per video for video details
  - Makes 1 API call per video for channel statistics
  - **NOT BATCHED** despite method name suggesting otherwise
- **Endpoints**: 
  - `youtube/v3/videos?parts=snippet,statistics,contentDetails`
  - `youtube/v3/channels?parts=snippet,statistics`
- **API Cost**: 1 unit per call each
- **Example**: 1,000 videos = 2,000 API calls (1,000 video + 1,000 channel)

**Total YouTube API Usage for 1,000 videos**: ~2,020 calls

#### 2. OpenAI API Calls

**Title Embeddings (`generateTitleEmbeddings`)**
- **Endpoint**: OpenAI embeddings API
- **Model**: text-embedding-3-small
- **Batching**: 100 titles per request (properly batched)
- **Output**: 1536D vectors truncated to 512D
- **Rate Limits**: Respects 3,000 RPM limit
- **Example**: 1,000 videos = 10 API calls
- **Pricing**: $0.00002 per 1,000 tokens ($0.02 per million tokens)
- **Cost Calculation**: 
  - Average title length: ~48 characters ≈ 12 tokens
  - 1,000 titles × 12 tokens = 12,000 tokens
  - Cost: 12,000 ÷ 1,000 × $0.00002 = **$0.00024**

#### 3. Replicate API Calls

**Thumbnail Embeddings (`generateThumbnailEmbeddings`)**
- **Model**: openai/clip-vit-large-patch14
- **Batching**: NO BATCHING - 1 thumbnail per request
- **Output**: 768D vectors
- **Rate Limits**: 5 concurrent requests, ~10/second sustained
- **Processing Time**: ~100 seconds for 1,000 thumbnails
- **Example**: 1,000 videos = 1,000 API calls
- **Pricing**: $0.00022 per prediction (official Replicate pricing)
- **Cost Calculation**:
  - Each thumbnail is one prediction
  - 1,000 thumbnails × $0.00022 = **$0.22**

#### 4. Database Operations

**Supabase Storage**
- Single bulk upsert operation
- Stores complete video metadata with embeddings
- Efficient implementation

**Pinecone Vector Storage**
- **Title Index**: Batched upload (50 vectors per request)
- **Thumbnail Index**: Batched upload (100 vectors per request)
- Both indices handle up to 10k vectors per query

**Local Export Files**
- JSON export with full metadata
- CSV export with key fields
- Saved to `/exports/` directory

### Complete Flow for 1,000 Video Channel Import

| Step | Operation | API Calls | Time | Cost |
|------|-----------|-----------|------|------|
| 1 | Fetch video IDs | 20 YouTube | 10s | - |
| 2 | Fetch video details | 1,000 YouTube | 5 min | - |
| 3 | Fetch channel stats | 1,000 YouTube | 5 min | - |
| 4 | Check existing videos | 1 Supabase | 1s | - |
| 5 | Generate title embeddings | 10 OpenAI | 30s | $0.00024 |
| 6 | Generate thumbnail embeddings | 1,000 Replicate | 100s | $0.22 |
| 7 | Store in Supabase | 1 Supabase | 2s | - |
| 8 | Upload to Pinecone | ~30 Pinecone | 10s | - |
| 9 | Generate exports | 0 APIs | 5s | - |
| **Total** | | **2,062 API calls** | **~12 min** | **~$0.22** |

### Worker System Details

#### Worker Architecture
- **Main Import Worker**: Handles complete import jobs
- **Title Vectorization Worker**: Dedicated to generating title embeddings
- **Thumbnail Vectorization Worker**: Dedicated to generating thumbnail embeddings
- **Coordination**: Workers check each other's status to avoid API contention

#### Worker Coordination
When multiple workers are running:
1. Import worker checks if vectorization workers are enabled
2. If yes, import worker skips embedding generation
3. Vectorization workers process videos missing embeddings separately
4. This prevents API rate limit conflicts

#### Job Processing Features
- **Concurrent Jobs**: Up to 3 jobs processed simultaneously
- **Retry Logic**: Failed jobs retry up to 3 times
- **Stuck Job Recovery**: Jobs processing >30 minutes are reset
- **Priority Queue**: Owner videos processed before competitor videos
- **Graceful Shutdown**: Workers complete active jobs before stopping

### Current System Inefficiencies

1. **YouTube API Waste**: Making 2 API calls per video instead of batching
   - Could batch 50 videos per call
   - Channel stats fetched repeatedly for same channel

2. **No Caching**: Channel statistics fetched multiple times for same channel

3. **Sequential Processing**: Some operations could be parallelized

4. **Replicate Not Batched**: Processing thumbnails one at a time

## Optimized System Design

### Optimization Opportunities

#### 1. Batch YouTube API Calls
**Implementation**: Use the code from `lib/unified-video-import-optimized.ts`
- Fetch 50 videos per API call
- Fetch all unique channels in one API call
- **Result**: 2,000 calls → 21 calls (99% reduction)

#### 2. Cache Channel Statistics
- Store channel stats in memory during import session
- **Result**: Eliminate redundant channel API calls

#### 3. Parallelize Independent Operations
- Run title and thumbnail embedding generation concurrently
- **Result**: 30-50% time reduction

#### 4. Batch Replicate Requests (Future)
- Replicate doesn't support batching currently
- Consider alternative embedding services that do

### Optimized Flow for 1,000 Video Channel Import

| Step | Operation | API Calls | Time | Cost |
|------|-----------|-----------|------|------|
| 1 | Fetch video IDs | 20 YouTube | 10s | - |
| 2 | Fetch video details (batched) | 20 YouTube | 10s | - |
| 3 | Fetch channel stats (batched) | 1 YouTube | 1s | - |
| 4 | Check existing videos | 1 Supabase | 1s | - |
| 5-6 | Generate embeddings (parallel) | | | |
| 5 | - Title embeddings | 10 OpenAI | 30s | $0.00024 |
| 6 | - Thumbnail embeddings | 1,000 Replicate | 100s | $0.22 |
| 7 | Store in Supabase | 1 Supabase | 2s | - |
| 8 | Upload to Pinecone | ~30 Pinecone | 10s | - |
| 9 | Generate exports | 0 APIs | 5s | - |
| **Total** | | **1,082 API calls** | **~8 min** | **~$0.22** |

### Implementation Priority

1. **Immediate (High Impact, Low Effort)**
   - Replace `fetchVideoDetailsBatch` with actual batching implementation
   - Use code from `unified-video-import-optimized.ts`
   - **Impact**: 95% reduction in YouTube API usage

2. **Short Term (Medium Impact, Medium Effort)**
   - Add channel stats caching
   - Parallelize embedding generation
   - **Impact**: 30% faster imports

3. **Long Term (Low Impact, High Effort)**
   - Investigate batch thumbnail embedding alternatives
   - Implement progress streaming
   - **Impact**: Better UX, marginal performance gains

## Cost Analysis

### Current System (per 1,000 videos)
- YouTube API: 2,020 units (20.2% of daily quota)
- OpenAI: $0.00024 (12,000 tokens)
- Replicate: $0.22 (1,000 predictions)
- **Total: $0.22 + 20.2% quota**

### Optimized System (per 1,000 videos)
- YouTube API: 41 units (0.41% of daily quota)
- OpenAI: $0.00024 (12,000 tokens)
- Replicate: $0.22 (1,000 predictions)
- **Total: $0.22 + 0.41% quota**

### Quota Impact
- **Current**: Can import ~5 channels with 1,000 videos each per day
- **Optimized**: Can import ~240 channels with 1,000 videos each per day
- **48x improvement in daily capacity**

## Implementation Plan

### Step 1: Fix YouTube API Batching (CRITICAL - 95% reduction)
**File**: `lib/unified-video-import.ts`

1. **Replace the broken `fetchVideoDetailsBatch` method** with the working version from `unified-video-import-optimized.ts`:
   - Current: Makes 2 API calls per video (video details + channel stats)
   - Fixed: Batches 50 videos per call + batches all channel stats
   - Implementation: Copy `fetchVideoMetadataOptimized` and `fetchChannelStatsBatch` methods

2. **Update the main processing flow**:
   ```typescript
   // Replace this:
   const videoDetails = await this.fetchVideoDetailsBatch(videoIds, source, userId);
   
   // With this:
   const videoDetails = await this.fetchVideoMetadataOptimized(videoIds, source, userId);
   ```

### Step 2: Add Channel Stats Caching
**Why**: Same channel's stats are fetched multiple times during import

1. **Add in-memory cache** at the class level:
   ```typescript
   private channelStatsCache = new Map<string, any>();
   ```

2. **Check cache before API call** in `fetchChannelStatsBatch`
3. **Clear cache** after import completes

### Step 3: Optimize Worker Coordination
**Current Issue**: When vectorization workers are enabled, import worker skips embeddings but doesn't parallelize other operations

1. **Parallelize independent operations**:
   - Fetch video details while checking database for duplicates
   - Generate exports while uploading to Pinecone

### Step 4: Consider Search API for Channel Fetching (Optional)
**Why**: Search API allows date filtering at API level
**Tradeoff**: Uses 100 units per call vs 1 unit for playlist API
**Best for**: Channels where you only want recent videos

### Summary Impact
| Optimization | Effort | API Reduction | Time Savings |
|-------------|--------|---------------|--------------|
| Fix YouTube batching | Low (copy existing code) | 95% | 50% |
| Add channel cache | Low | 5-10% | - |
| Parallelize operations | Medium | - | 30% |
| Use Search API | Medium | Varies | Varies |

**The most critical fix is Step 1** - the code already exists in `unified-video-import-optimized.ts` and just needs to be copied over. This single change would:
- Reduce YouTube API usage from 2,020 to 41 calls per 1,000 videos
- Allow importing 48x more content per day
- Cut import time in half