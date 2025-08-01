# Transcript Fetching Guide for 170K Videos

## Overview

Your current system has transcripts for only 128 out of 175,057 videos (0.07%). This guide provides multiple approaches to efficiently fetch transcripts for the remaining videos.

## Current System Analysis

### How Transcripts Are Currently Handled

1. **Storage Structure**:
   - Transcripts are NOT stored in the `videos` table
   - They're stored in the `chunks` table as segments
   - Each video's transcript is split into ~16 chunks on average
   - Chunks include timestamps, embeddings, and metadata

2. **Current Process**:
   - API endpoint: `/api/youtube/transcript/route.ts`
   - Method: Scrapes YouTube's caption data from video pages
   - Limitations: Slow, prone to rate limiting, no batch support

## Recommended Approaches for Bulk Processing

### Approach 1: YouTube Transcript API (Python) - RECOMMENDED ⭐

**Pros**:
- Much faster than scraping (10-20x)
- Handles multiple languages automatically
- Better error handling and retry logic
- No scraping = less likely to be blocked
- Parallel processing with multiprocessing

**Implementation**: See `scripts/youtube-dl-transcript-fetcher.py`

**Setup**:
```bash
pip install youtube-transcript-api psycopg2-binary tqdm
export DATABASE_URL='your-supabase-connection-string'
python scripts/youtube-dl-transcript-fetcher.py
```

**Expected Performance**:
- 50-100 videos/minute with 8 workers
- ~30-60 hours for 170K videos
- Automatic resume on interruption

### Approach 2: Node.js Batch Processor

**Pros**:
- Uses your existing API infrastructure
- Native to your stack
- Good for smaller batches

**Implementation**: See `scripts/bulk-transcript-fetcher.js`

**Setup**:
```bash
npm install p-limit
node scripts/bulk-transcript-fetcher.js
```

**Expected Performance**:
- 10-20 videos/minute (limited by scraping)
- ~140-280 hours for 170K videos

### Approach 3: Distributed Processing with Workers

For maximum speed, split the workload:

1. **Create job queue in database**:
```sql
CREATE TABLE transcript_jobs (
  video_id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
  attempts INT DEFAULT 0,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Populate from videos without transcripts
INSERT INTO transcript_jobs (video_id)
SELECT v.id 
FROM videos v
LEFT JOIN chunks c ON v.id = c.video_id AND c.content_type = 'transcript'
WHERE c.video_id IS NULL;
```

2. **Run multiple workers**:
```bash
# Terminal 1-5 (run 5 workers)
WORKER_ID=1 python scripts/youtube-dl-transcript-fetcher.py
WORKER_ID=2 python scripts/youtube-dl-transcript-fetcher.py
# etc...
```

### Approach 4: Third-Party Services

For fastest results with budget:

1. **YouTube Data API v3** with captions.download
   - Requires OAuth authentication
   - Official API, most reliable
   - 10,000 quota units/day limit

2. **Whisper AI for videos without captions**
   - Download video audio
   - Transcribe with OpenAI Whisper
   - More expensive but works for all videos

## Optimization Strategies

### 1. Prioritize High-Value Videos
```sql
-- Get videos by importance (views, recency, etc.)
SELECT id, title, view_count, published_at
FROM videos
WHERE id NOT IN (
  SELECT DISTINCT video_id FROM chunks WHERE content_type = 'transcript'
)
ORDER BY 
  view_count DESC,  -- Most viewed first
  published_at DESC -- Recent videos
LIMIT 10000;
```

### 2. Language Detection
- Check video metadata for language hints
- Use channel country/language
- Prioritize English content first

### 3. Caching Strategy
- Store raw transcripts temporarily
- Process in batches for chunking
- Use Redis for rate limit tracking

### 4. Error Handling
- Track videos with no captions available
- Retry failed videos with exponential backoff
- Log permanently failed videos for alternative processing

## Quality Improvements for Topic Classification

Once you have transcripts:

1. **Regenerate BERTopic clusters** with transcript data:
```python
# Combine title + transcript excerpts for better embeddings
combined_text = f"{video.title} {transcript[:500]}"
```

2. **Improve topic naming**:
```python
# Use GPT-4 to generate topic names from sample transcripts
sample_transcripts = get_sample_transcripts_for_topic(topic_id, n=10)
topic_name = generate_topic_name_with_gpt4(sample_transcripts)
```

3. **Create topic summaries**:
- Extract key phrases from transcripts
- Identify common patterns
- Generate human-readable descriptions

## Monitoring and Maintenance

### Progress Tracking
```sql
-- Monitor transcript coverage
SELECT 
  COUNT(DISTINCT v.id) as total_videos,
  COUNT(DISTINCT c.video_id) as videos_with_transcripts,
  ROUND(COUNT(DISTINCT c.video_id)::NUMERIC / COUNT(DISTINCT v.id) * 100, 2) as coverage_percent
FROM videos v
LEFT JOIN chunks c ON v.id = c.video_id AND c.content_type = 'transcript';
```

### Daily Updates
Set up a cron job for new videos:
```bash
# Run daily at 2 AM
0 2 * * * cd /path/to/project && python scripts/fetch_new_transcripts.py
```

## Cost Estimates

1. **YouTube Transcript API**: Free (using youtube-transcript-api)
2. **Storage**: ~50GB for 170K transcripts in chunks table
3. **Processing time**: 30-280 hours depending on approach
4. **Compute**: Minimal (can run on small VPS)

## Next Steps

1. **Immediate**: Start with Python youtube-transcript-api approach
2. **Week 1**: Process top 10K most-viewed videos
3. **Week 2-4**: Complete remaining videos
4. **Ongoing**: Set up daily updates for new videos
5. **Future**: Implement Whisper transcription for videos without captions