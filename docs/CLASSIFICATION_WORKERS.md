# Classification Workers Documentation

This document describes the video classification workers that automatically classify videos by topic and format.

## Overview

The classification system consists of three workers that can run independently or together:

1. **Format Classification Worker** - Classifies videos into formats (tutorial, listicle, explainer, etc.)
2. **Topic Classification Worker** - Assigns hierarchical topics using BERTopic clusters
3. **Video Classification Worker** - Combined worker that does both topic and format classification

## Prerequisites

- Node.js with TypeScript support
- Environment variables configured (see main README)
- Database with videos to classify
- For topic classification: Either BERTopic clusters in database or exported cluster file

## Running the Workers

### Using npm scripts

```bash
# Run individual workers
npm run worker:format      # Format classification only
npm run worker:topic       # Topic classification only  
npm run worker:classify    # Combined classification

# Run all classification workers concurrently
npm run workers:classification

# Run ALL workers (import, vectorization, and classification)
npm run workers:all
```

### Using the shell script

```bash
# Run individual workers
./scripts/run-classification-workers.sh format
./scripts/run-classification-workers.sh topic
./scripts/run-classification-workers.sh video

# Run all in separate terminals (macOS)
./scripts/run-classification-workers.sh all
```

### Direct execution with tsx

```bash
# Ensure environment variables are loaded
tsx format-classification-worker.ts
tsx topic-classification-worker.ts
tsx video-classification-worker.ts
```

## Worker Details

### Format Classification Worker

**File:** `format-classification-worker.ts`

Classifies videos into content formats using OpenAI's GPT-4o-mini model.

**Features:**
- Batch processing (500 videos at a time)
- Parallel LLM calls for efficiency
- Automatic retry on errors
- Progress tracking and statistics
- Token usage tracking

**Supported Formats:**
- `tutorial` - Step-by-step guides
- `listicle` - Top N lists, rankings
- `explainer` - Educational explanations
- `case_study` - Real examples, experiments
- `news_analysis` - Current events analysis
- `personal_story` - Personal experiences
- `product_focus` - Reviews, comparisons
- `live_stream` - Live broadcasts
- `shorts` - Short-form content
- `vlog` - Video logs
- `compilation` - Best-of videos
- `update` - Channel updates

### Topic Classification Worker

**File:** `topic-classification-worker.ts`

Assigns hierarchical topics to videos using k-nearest neighbor search on BERTopic clusters.

**Features:**
- Fast local processing (no API calls)
- K-NN algorithm with configurable k (default: 10)
- Hierarchical topics: Domain > Niche > Micro-topic
- Confidence scoring
- Loads clusters from database or local file

**Requirements:**
- Videos must have title embeddings
- BERTopic clusters must be available

**Topic Hierarchy Example:**
```
Domain: Technology
  Niche: Software Development  
    Micro-topic: Python Web Frameworks
```

### Video Classification Worker

**File:** `video-classification-worker.ts`

Combined worker that performs both topic and format classification in a single pass.

**Features:**
- Intelligent batching based on what each video needs
- Shared cluster loading for efficiency
- Comprehensive progress tracking
- Low-confidence case logging
- Handles videos needing one or both classifications

**Processing Logic:**
1. Fetches videos needing either classification
2. Checks what each video needs (topic, format, or both)
3. Applies appropriate classification
4. Stores results in database

## Worker Control

All workers are controlled via the Worker Dashboard UI:

1. Navigate to http://localhost:3000/dashboard/workers
2. Find the classification worker you want to control
3. Toggle the enable/disable switch

Workers will:
- Start in disabled state
- Poll for enable status every 5 seconds
- Begin processing when enabled
- Pause processing when disabled
- Show heartbeat and progress information

## Database Schema

Workers expect these columns in the `videos` table:

### For Format Classification:
- `format_type` - The assigned format
- `format_confidence` - Confidence score (0-1)
- `format_primary` - Primary format (same as format_type)
- `classification_llm_used` - Whether LLM was used
- `classification_timestamp` - When classified

### For Topic Classification:
- `topic_domain` - Top-level topic
- `topic_niche` - Mid-level topic
- `topic_micro` - Specific topic
- `topic_cluster_id` - BERTopic cluster ID
- `topic_confidence` - Confidence score (0-1)
- `topic_reasoning` - Explanation of assignment
- `topic_classified_at` - When classified

## Performance Considerations

### Format Classification
- Uses OpenAI API with rate limiting
- Processes in batches of 15 videos per API call
- Up to 20 parallel API calls
- Approximately 50-100 videos/minute depending on rate limits

### Topic Classification
- Local processing (no API calls)
- Very fast - 500+ videos/minute
- Limited by database write speed
- Requires ~500MB RAM for cluster data

### Combined Classification
- Balances both operations
- Intelligently batches based on needs
- Approximately 30-50 videos/minute

## Monitoring and Debugging

### Log Output
Workers provide detailed logging:
```
🎬 Processing batch of 50 videos...
✅ Batch completed in 12.3s: 50 videos classified
💰 Tokens used: 1,234 (total session: 45,678)
⚡ Processing speed: 4.1 videos/second
```

### Progress Reports
Periodic progress reports show:
- Videos processed
- Classification rates
- Remaining work
- Token usage (for format classification)

### Error Handling
- Automatic retry with exponential backoff
- Graceful handling of API errors
- Database connection resilience
- Clean shutdown on SIGINT/SIGTERM

## Cost Estimation

Format classification using GPT-4o-mini:
- ~100-150 tokens per video
- $0.15 per 1M input tokens
- $0.60 per 1M output tokens
- Estimated: $0.20-0.40 per 1,000 videos

Topic classification:
- No API costs (local processing)
- Only database operations

## Troubleshooting

### Common Issues

1. **"Missing required environment variables"**
   - Ensure `.env` file has all required variables
   - Check OPENAI_API_KEY for format classification

2. **"No videos to process"**
   - Check if videos have required fields (title, channel_id)
   - For topics: Ensure title embeddings exist
   - Run vectorization workers first if needed

3. **"BERTopic clusters not found"**
   - Run cluster generation script
   - Or export clusters from existing system

4. **Rate limit errors**
   - Reduce batch size in worker code
   - Add longer delays between batches
   - Check OpenAI usage dashboard

5. **Worker not starting**
   - Check worker_control table in database
   - Ensure worker type entry exists
   - Toggle enable status in UI

### Debug Mode

Set environment variable for verbose logging:
```bash
DEBUG=classification npm run worker:classify
```

## Best Practices

1. **Run Order**
   - Import videos first
   - Generate embeddings (vectorization workers)
   - Then run classification workers

2. **Resource Usage**
   - Run format classification during off-peak hours
   - Topic classification can run anytime (low resource)
   - Monitor OpenAI API usage

3. **Batch Sizing**
   - Larger batches for topic classification (100-500)
   - Smaller batches for format classification (50-100)
   - Adjust based on your rate limits

4. **Monitoring**
   - Check worker dashboard regularly
   - Monitor error rates in logs
   - Track classification confidence scores
   - Review low-confidence cases