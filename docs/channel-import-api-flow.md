# Channel Import API Flow Documentation

## Complete API Call Sequence for Channel Import

This document details the exact sequence of API calls made when importing a YouTube channel through the unified video import system.

## Overview

When importing a channel, the system makes calls to:
1. **YouTube Data API** - For video discovery and metadata
2. **OpenAI API** - For title embeddings (512D vectors)
3. **Replicate API** - For thumbnail embeddings (768D CLIP vectors)
4. **Supabase Database** - For storage operations
5. **Pinecone Vector Database** - For similarity search indexes

## Detailed API Flow

### Phase 1: Video Discovery from Channel

#### 1.1 Get Channel Details
```
GET https://www.googleapis.com/youtube/v3/channels
    ?part=contentDetails
    &id={channelId}
    &key={YOUTUBE_API_KEY}
```
- **Purpose**: Retrieve the channel's uploads playlist ID
- **Rate Limit**: 10,000 units/day (costs 1 unit)

#### 1.2 Fetch Videos from Uploads Playlist (Paginated)
```
GET https://www.googleapis.com/youtube/v3/playlistItems
    ?part=snippet
    &playlistId={uploadsPlaylistId}
    &maxResults=50
    &pageToken={nextPageToken}
    &key={YOUTUBE_API_KEY}
```
- **Purpose**: Get all video IDs from the channel
- **Pagination**: 50 videos per page
- **Rate Limit**: 10,000 units/day (costs 1 unit per page)
- **Implementation**: Continues fetching until all videos retrieved or `maxVideosPerChannel` limit reached

#### 1.3 Filter Shorts (Optional)
If `excludeShorts` is enabled:
```
GET https://www.googleapis.com/youtube/v3/videos
    ?part=contentDetails
    &id={videoIds.join(',')}
    &key={YOUTUBE_API_KEY}
```
- **Purpose**: Get video durations to filter out shorts (<60 seconds)
- **Batch Size**: Up to 50 video IDs per request
- **Rate Limit**: 10,000 units/day (costs 1 unit per 50 videos)

### Phase 2: Video Metadata Extraction

#### 2.1 Fetch Video Details
```
GET https://www.googleapis.com/youtube/v3/videos
    ?part=snippet,statistics,contentDetails
    &id={videoId}
    &key={YOUTUBE_API_KEY}
```
- **Purpose**: Get full video metadata including title, description, views, etc.
- **Processing**: One request per video (not batched in current implementation)
- **Rate Limit**: 10,000 units/day (costs 1 unit per video)

#### 2.2 Fetch Channel Statistics
For each unique channel in the video batch:
```
GET https://www.googleapis.com/youtube/v3/channels
    ?part=snippet,statistics
    &id={channelId}
    &key={YOUTUBE_API_KEY}
```
- **Purpose**: Get channel subscriber count, total views, video count
- **Rate Limit**: 10,000 units/day (costs 1 unit per channel)

### Phase 3: Database Storage

#### 3.1 Upsert Videos to Supabase
```sql
INSERT INTO videos (
    id, title, channel_id, channel_name, view_count, 
    published_at, performance_ratio, thumbnail_url, 
    description, data_source, is_competitor, 
    import_date, user_id, metadata
) VALUES (...)
ON CONFLICT (id) DO UPDATE SET ...
```
- **Batch Size**: All videos in single upsert operation
- **Conflict Resolution**: Updates existing records

### Phase 4: Embedding Generation

#### 4.1 Title Embeddings (OpenAI)
```
POST https://api.openai.com/v1/embeddings
{
    "model": "text-embedding-3-small",
    "input": [/* array of video titles */],
    "encoding_format": "float"
}
```
- **Batch Size**: 100 titles per request (configurable)
- **Model**: text-embedding-3-small (1536D, truncated to 512D)
- **Rate Limit**: Depends on tier (typically 500 RPM)
- **Delay**: 100ms between batches
- **Cost**: ~$0.02 per 1M tokens

#### 4.2 Thumbnail Embeddings (Replicate)
```
POST https://api.replicate.com/v1/predictions
{
    "version": "krthr/clip-embeddings:1c0371070cb827ec3c7f2f28adcdde54b50dcd239aa6faea0bc98b174ef03fb4",
    "input": {
        "image": "{thumbnailUrl}"
    }
}
```
- **Processing**: One thumbnail at a time
- **Concurrency**: 5 concurrent requests (adaptive)
- **Model**: CLIP ViT-Large-Patch14 (768D vectors)
- **Rate Limit**: 10 requests/second
- **Retry Logic**: 3 retries with exponential backoff for rate limits
- **Delay**: 500ms between batches
- **Cost**: $0.00098 per image
- **Caching**: Results cached locally to avoid redundant API calls

### Phase 5: Vector Database Upload

#### 5.1 Upload Title Embeddings to Pinecone
```
POST https://youtube-titles-prod-{env}.pinecone.io/vectors/upsert
{
    "vectors": [{
        "id": "{videoId}",
        "values": [/* 512D embedding */],
        "metadata": {
            "title": "...",
            "channel_id": "...",
            "embedding_version": "v1"
        }
    }]
}
```
- **Index**: youtube-titles-prod (512 dimensions)
- **Batch Processing**: All successful embeddings in one request

#### 5.2 Upload Thumbnail Embeddings to Pinecone
```
POST https://video-thumbnails-{env}.pinecone.io/vectors/upsert
{
    "vectors": [{
        "id": "{videoId}",
        "values": [/* 768D embedding */],
        "metadata": {
            "embedding_version": "clip-vit-large-patch14"
        }
    }]
}
```
- **Index**: video-thumbnails (768 dimensions)
- **Batch Processing**: All successful embeddings in one request

### Phase 6: Local Export Generation

Local files are created in `/exports/`:
- `title-embeddings-{timestamp}.json` - Full title embeddings with metadata
- `title-embeddings-metadata-only-{timestamp}.json` - Metadata without vectors
- `thumbnail-embeddings-{timestamp}.json` - Full thumbnail embeddings
- `thumbnail-embeddings-{timestamp}.csv` - CSV format for analysis
- `thumbnail-embeddings-{timestamp}-metadata-only.json` - Metadata only

## Performance Characteristics

### For a Channel with 1,000 Videos:

1. **YouTube API Calls**:
   - 1 channel details call
   - 20 playlist pages (50 videos each)
   - 20 batch calls for shorts filtering (if enabled)
   - 1,000 individual video detail calls
   - ~10 channel statistics calls (for unique channels)
   - **Total**: ~1,051 API calls

2. **OpenAI API Calls**:
   - 10 batch requests (100 titles each)
   - **Total**: 10 API calls

3. **Replicate API Calls**:
   - 1,000 individual thumbnail requests
   - Processed in batches of 75 with 5 concurrent
   - **Total**: 1,000 API calls

4. **Database Operations**:
   - 1 bulk upsert for all videos
   - 2 Pinecone upserts (titles and thumbnails)

### Time Estimates:
- YouTube API: ~5-10 minutes (rate limited)
- OpenAI Embeddings: ~1-2 minutes
- Replicate Embeddings: ~20-30 minutes (rate limited to 10 req/s)
- **Total Time**: ~30-45 minutes for 1,000 videos

### Cost Estimates:
- YouTube API: Free (within quota)
- OpenAI: ~$0.05 (depends on title length)
- Replicate: $0.98 (1,000 × $0.00098)
- **Total Cost**: ~$1.03 for 1,000 videos

## Rate Limiting and Optimization

### Current Optimizations:
1. **Caching**: Thumbnail embeddings are cached locally
2. **Batch Processing**: OpenAI titles processed in batches
3. **Concurrent Processing**: 5 concurrent Replicate requests
4. **Database Filtering**: RSS feeds check existing videos before processing
5. **Adaptive Rate Limiting**: Adjusts concurrency based on API response

### Potential Improvements:
1. Batch YouTube video details API calls (currently individual)
2. Implement Redis caching for frequently accessed channels
3. Use YouTube API's `fields` parameter to reduce response size
4. Implement progressive loading for large channels