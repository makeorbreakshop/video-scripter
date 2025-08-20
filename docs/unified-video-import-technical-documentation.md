# Unified Video Import System - Technical Documentation

## Overview

The Unified Video Import System consolidates all video import mechanisms into a single, standardized service that handles metadata extraction, embedding generation, content classification, storage, and exports consistently across all import sources.

## Architecture

### Core Components

1. **Unified Service** (`/lib/unified-video-import.ts`)
   - `VideoImportService` class that handles all processing logic
   - Standardized interfaces for requests and responses
   - Integrated error handling and logging
   - **YouTube API Fallback System**: Automatic failover to backup API key when primary quota exhausted
   - **Channel Stats Caching**: In-memory cache to reduce redundant YouTube API calls
   - **Job ID Tracking**: Links imports to background job system for monitoring

2. **Unified API Endpoint** (`/app/api/video-import/unified/route.ts`)
   - Single POST endpoint for all import operations
   - Input validation and rate limiting (1,000 items default, 10,000 for RSS)
   - **Queue System Integration**: Supports both synchronous and asynchronous processing
   - **Duplicate Detection**: Checks `channel_import_status` to skip already-imported channels
   - Comprehensive documentation via GET endpoint

3. **Worker/Queue System**
   - **Background Processing**: Default mode uses job queue for large imports
   - **Job Creation**: Creates entries in `jobs` table with status tracking
   - **Worker Processing**: Dedicated workers handle import jobs asynchronously
   - **Progress Tracking**: Real-time status updates via job monitoring
   - **Synchronous Mode**: Optional `useQueue: false` for immediate processing

4. **Supporting Services**
   - **BERTopic Classification Service** (`/lib/bertopic-classification-service.ts`)
   - **Temporal Baseline Processor** (`/lib/temporal-baseline-processor.ts`)
   - **LLM Format Classification Service** (`/lib/llm-format-classification-service.ts`)
   - **Pinecone Services**: Separate services for titles, thumbnails, and summaries
   - **Quota Tracker** (`/lib/youtube-quota-tracker.ts`): Real-time quota monitoring

5. **Updated Legacy Endpoints**
   - `/app/api/youtube/daily-monitor/route.ts` - RSS monitoring
   - `/app/api/youtube/import-competitor/route.ts` - Competitor analysis
   - Additional endpoints can be migrated following the same pattern

## API Reference

### Unified Import Endpoint

```
POST /api/video-import/unified
```

#### Request Body

```typescript
{
  source: 'competitor' | 'discovery' | 'rss' | 'owner' | 'sync',
  videoIds?: string[],
  channelIds?: string[],
  rssFeedUrls?: string[],
  useQueue?: boolean,  // Default: true - Use background job queue
  options?: {
    skipEmbeddings?: boolean,
    skipExports?: boolean,
    skipThumbnailEmbeddings?: boolean,
    skipTitleEmbeddings?: boolean,
    skipClassification?: boolean,
    skipSummaries?: boolean,  // Skip LLM summary generation
    summaryModel?: string,     // Model for summary generation (default: gpt-4o-mini)
    batchSize?: number,
    forceReEmbed?: boolean,
    maxVideosPerChannel?: number,
    // Competitor-specific options
    timePeriod?: string,       // 'all' or number of days
    excludeShorts?: boolean,   // Exclude YouTube Shorts
    userId?: string,           // User ID for tracking
    // Date filtering options
    dateFilter?: 'all' | 'recent',
    dateRange?: number         // Days to look back (default: 1095)
  }
}
```

#### Response

```typescript
{
  success: boolean,
  message: string,
  videosProcessed: number,
  embeddingsGenerated: {
    titles: number,
    thumbnails: number
  },
  classificationsGenerated: number,  // Total classifications (topics + formats)
  summariesGenerated: number,        // LLM summaries created
  summaryEmbeddingsGenerated: number, // Summary embeddings created
  exportFiles: string[],
  errors: string[],
  processedVideoIds: string[],
  // Queue-specific fields
  jobId?: string,                    // Job ID when using queue
  status?: string,                   // Job status
  skippedChannels?: string[],        // Channels already imported
  timestamp: string
}
```

### Usage Examples

#### Competitor Import
```javascript
const response = await fetch('/api/video-import/unified', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    source: 'competitor',
    channelIds: ['UC6107grRI4m0o2-emgoDnAA'],
    options: {
      batchSize: 50,
      skipThumbnailEmbeddings: false
    }
  })
});
```

#### RSS Import
```javascript
const response = await fetch('/api/video-import/unified', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    source: 'rss',
    rssFeedUrls: ['https://www.youtube.com/feeds/videos.xml?channel_id=UC6107grRI4m0o2-emgoDnAA'],
    options: {
      skipExports: true
    }
  })
});
```

#### Direct Video Import
```javascript
const response = await fetch('/api/video-import/unified', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    source: 'discovery',
    videoIds: ['dQw4w9WgXcQ', 'jNQXAC9IVRw'],
    options: {
      forceReEmbed: true
    }
  })
});
```

## Processing Pipeline

### 1. Video Metadata Extraction
- Fetches video details from YouTube Data API v3
- Validates and filters videos (excludes shorts, invalid data)
- Calculates performance ratios based on view counts
- Extracts thumbnail URLs (prioritizes maxres > high > medium > default)
- **Quota Tracking**: All YouTube API calls are tracked for quota management

### 2. Channel Maintenance & Enrichment
- **Automatic Channel Tracking**: Extracts unique channels from imported videos
- **Channel Table Updates**: Upserts channels with basic info (id, name, thumbnail)
- **Discovery Source Tracking**: Records where each channel was discovered
- **Batch Enrichment**: Enriches channels with YouTube API data
  - Processes up to 50 channels per API call
  - Fetches: statistics, keywords, topics, upload playlists, COPPA status
  - Updates subscriber counts, view counts, video counts
  - Stores metadata: topic IDs, banner URLs, localizations
- **Smart Refresh**: Only enriches channels not synced in last 7 days
- **Quota Impact**: Minimal - typically 2-20 API calls for hundreds of videos
- **Non-blocking**: Enrichment failures don't stop video import

### 3. Embedding Generation

#### Title Embeddings
- **Model**: OpenAI `text-embedding-3-small`
- **Dimensions**: 512 (truncated from full embedding)
- **Purpose**: Semantic search and content similarity
- **Storage**: Pinecone main index (`youtube-titles-prod`)
- **Database Tracking**: `pinecone_embedding_version` field set to 'v1'

#### Thumbnail Embeddings
- **Model**: Replicate CLIP `krthr/clip-embeddings`
- **Dimensions**: 768
- **Purpose**: Visual similarity search
- **Storage**: Pinecone thumbnail index (`video-thumbnails`)
- **Caching**: Local cache to reduce API costs
- **Database Tracking**: `thumbnail_embedding_version` field set to 'v1'
- **Cost**: ~$0.00098 per image

### 4. LLM Summary Generation

#### Summary Generation
- **Method**: GPT-4o-mini with action-focused prompts
- **Purpose**: Extract core content without promotional material
- **Storage**: `llm_summary` field in database
- **Timing**: Runs in parallel with title/thumbnail embeddings
- **Cost**: ~$0.000116 per video ($0.06 per 1,000 videos)
- **Processing**: ~10-20 videos concurrently

#### Summary Embeddings
- **Model**: OpenAI `text-embedding-3-small`
- **Dimensions**: 512
- **Purpose**: Semantic search on video content summaries
- **Storage**: Pinecone main index (`llm-summaries` namespace)
- **Database Tracking**: `llm_summary_embedding_synced` field set to true
- **Timing**: After summary generation completes

### 5. Content Classification

#### Topic Classification
- **Method**: K-nearest neighbor using title embeddings
- **Reference**: 777 BERTopic clusters with centroids
- **Hierarchy**: 3-level assignment (domain → niche → micro-topic)
- **Confidence**: Based on embedding similarity distance
- **Timing**: Immediately after title embedding generation
- **Processing**: ~500+ videos/minute (local computation)

#### Format Classification
- **Method**: LLM-based classification using GPT-4o-mini
- **Categories**: 12 format types:
  - `tutorial` - Step-by-step instructional content
  - `listicle` - Numbered or listed content
  - `explainer` - Concept explanations
  - `case_study` - Real-world examples
  - `news_analysis` - Current events coverage
  - `personal_story` - Personal experiences
  - `product_focus` - Product-centered content
  - `live_stream` - Live broadcasts
  - `shorts` - Short-form content
  - `vlog` - Video logs
  - `compilation` - Multi-clip content
  - `update` - Channel/project updates
- **Batch Processing**: 15 videos per API call
- **Confidence Scoring**: 0-1 scale with reasoning
- **Cost**: ~$0.06 per 1,000 videos
- **Processing**: ~50-100 videos/minute

### 6. Data Storage

#### Storage Strategy
The system uses a **three-tier storage approach** optimized for different batch sizes:

1. **Direct PostgreSQL Connection** (100+ videos)
   - Uses `pg.Pool` for direct database access
   - Bypasses Supabase API and Cloudflare protection
   - Bulk INSERT with ON CONFLICT for upsert behavior
   - Processes 500 videos per chunk
   - ~27x performance improvement over API calls

2. **Chunked Supabase API** (50-99 videos or fallback)
   - Uses Supabase client with smaller chunks (50 videos)
   - 2-second delays between chunks to avoid rate limits
   - Automatic Cloudflare detection and retry with smaller chunks

3. **Standard Supabase API** (<50 videos)
   - Direct upsert for small batches
   - Most efficient for small operations

#### Direct Database Connection Setup
```bash
# Required environment variable for bulk operations
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

- Use the **pooler connection** (port 6543) for better handling
- Get from Supabase Dashboard > Settings > Database > Connection String (URI)
- Enables bulk operations that would timeout via API

#### Supabase Database
```sql
-- Core video table structure (current production schema)
CREATE TABLE videos (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text,
  channel_id text NOT NULL,
  channel_name text,
  view_count integer DEFAULT 0,
  like_count integer,
  comment_count integer,
  duration text,
  published_at timestamptz,
  thumbnail_url text,
  channel_avg_views double precision,
  performance_ratio double precision DEFAULT 1,
  outlier_factor double precision,
  niche text,
  data_source text DEFAULT 'competitor',
  is_competitor boolean DEFAULT true,
  import_date timestamptz DEFAULT now(),
  imported_by uuid,
  metadata jsonb,
  
  -- Embedding tracking
  pinecone_embedded boolean DEFAULT false,
  pinecone_embedding_version varchar(10),
  pinecone_last_updated timestamp,
  embedding_thumbnail_synced boolean DEFAULT false,
  thumbnail_embedding_version varchar(10),
  thumbnail_analysis_metadata jsonb,
  
  -- Classification fields
  topic_level_1 integer,
  topic_level_2 integer,
  topic_level_3 integer,
  topic_domain text,
  topic_niche text,
  topic_micro text,
  topic_cluster_id integer,
  topic_cluster_old integer,
  topic_confidence numeric(3,2),
  bertopic_version text,
  format_type text,
  format_primary text,
  format_confidence numeric(3,2),
  format_llm_used boolean DEFAULT false,
  classification_llm_used boolean DEFAULT false,
  classification_timestamp timestamptz,
  classified_at timestamptz,
  
  -- LLM Summary fields
  llm_summary text,
  llm_summary_generated_at timestamp,
  llm_summary_model varchar(50) DEFAULT 'gpt-4o-mini',
  llm_summary_embedding_synced boolean DEFAULT false,
  
  -- Performance metrics
  rolling_baseline_views integer,
  channel_baseline_at_publish numeric,
  temporal_performance_score numeric,
  envelope_performance_ratio numeric,
  envelope_performance_category text,
  first_day_views integer,
  first_week_views integer,
  first_month_views integer,
  view_velocity_7d double precision,
  view_velocity_30d double precision,
  age_confidence double precision,
  
  -- Content flags
  is_short boolean DEFAULT false,
  is_institutional boolean DEFAULT false,
  
  -- System fields
  user_id uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### Vector Storage
- **Pinecone Main Index**: Title embeddings (512D)
- **Pinecone Thumbnail Index**: Thumbnail embeddings (768D)
- **Local Cache**: Thumbnail embeddings with 24-hour TTL

#### Bulk Insert Implementation
```typescript
// Direct database storage for 100+ videos
private async storeVideoDataDirect(videos: VideoMetadata[]): Promise<void> {
  const client = await this.pool.connect();
  
  // Set long timeout for bulk operations
  await client.query("SET statement_timeout = '10m'");
  
  // Process in chunks of 500 to avoid parameter limits
  const CHUNK_SIZE = 500;
  
  // Build VALUES clause for bulk INSERT
  const query = `
    INSERT INTO videos (
      id, title, description, channel_id, channel_name, ...
    ) VALUES ${valueStrings.join(', ')}
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      view_count = EXCLUDED.view_count,
      ... // All fields updated
      updated_at = NOW()
  `;
  
  await client.query(query, values);
}
```

#### Temporal Baseline Analytics Processing
- **Automatic Trigger**: Temporal baseline processing automatically triggered after successful import
- **Batch Size**: Processes up to 1,000 videos per trigger in a single efficient UPDATE
- **Calculation Method**: Average of last 10 videos from channel within 30 days before publish date
- **Performance Score**: `temporal_performance_score = view_count / channel_baseline_at_publish`
- **Function**: `trigger_temporal_baseline_processing()` called with imported video count
- **Daily Updates**: Automated cron job recalculates baselines for videos reaching 30-day maturity
- **Efficiency**: Uses single UPDATE statement with correlated subqueries for batch processing

### 7. Temporal Performance Analytics

#### Overview
The temporal baseline system provides age-adjusted performance metrics by comparing videos to their channel's historical performance at the time of publication.

#### Calculation Method
- **Temporal Baseline** (`channel_baseline_at_publish`):
  - Calculates average view count of the last 10 videos from the same channel
  - Only considers videos published within 30 days before the current video
  - Excludes YouTube Shorts (videos marked as `is_short = true`)
  - Defaults to 1.0 if insufficient historical data

- **Temporal Performance Score** (`temporal_performance_score`):
  - Formula: `video_view_count / channel_baseline_at_publish`
  - Score > 2.0: Exceptional performance (green)
  - Score 1.0-2.0: Average to good performance (gray)
  - Score < 1.0: Below average performance (red)

#### Processing Flow
1. **On Import**: Videos receive immediate baseline calculation via INSERT trigger
2. **Batch Processing**: `trigger_temporal_baseline_processing()` handles bulk imports efficiently
3. **Daily Updates**: Cron job recalculates baselines for videos reaching 30-day maturity
4. **Performance**: Single UPDATE statement processes up to 1,000 videos without timeouts

#### Database Functions
- `calculate_baseline_on_insert()`: BEFORE INSERT trigger for new videos
- `trigger_temporal_baseline_processing(batch_size)`: Batch processing function
- `daily_baseline_update_smart()`: Daily recalculation for mature videos
- `calculate_video_channel_baseline(video_id)`: Individual baseline calculation

#### Implementation Details
- Replaced legacy `rolling_baseline_views` (1-year average) system
- Uses efficient correlated subqueries instead of loops
- Processes batches in single UPDATE statement for performance
- Function-level timeout set to 2 minutes for large batches

### 8. Export System

#### Export Formats
- **JSON**: Full embeddings with metadata
- **CSV**: Tabular format for analysis
- **Metadata-Only**: Video information without embeddings

#### Export Locations
- **Directory**: `/exports/`
- **Naming**: `{type}-embeddings-{timestamp}.{format}`
- **Retention**: Files are kept indefinitely for backup/analysis

#### Export Behavior
- **Note**: RSS monitor and competitor imports typically set `skipExports: true` to prevent duplicate files
- **Manual Exports**: Can be triggered separately when needed
- **Automatic Exports**: Only generated when `skipExports` is false or undefined

### 9. Error Handling

#### Retry Logic
- YouTube API failures: 3 retries with exponential backoff
- Replicate API rate limits: Adaptive rate limiting
- Database connection issues: Automatic retry with circuit breaker

#### Graceful Degradation
- Embedding failures don't stop video import
- Export failures don't stop processing
- Partial successes are properly tracked

## Configuration

### Environment Variables

```bash
# Required
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
YOUTUBE_API_KEY=your_youtube_api_key
OPENAI_API_KEY=your_openai_api_key
REPLICATE_API_TOKEN=your_replicate_token

# Direct Database Connection (for bulk operations)
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

# Pinecone
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=youtube-titles-prod
PINECONE_THUMBNAIL_INDEX_NAME=video-thumbnails
PINECONE_SUMMARY_INDEX_NAME=video-summaries
```

### Rate Limits

- **YouTube API**: 10,000 units/day (optimized from 100 to 1 unit per channel)
  - channels.list: 1 unit per 50 channels (enrichment)
  - playlistItems.list: 1 unit per 50 videos
  - videos.list: 1 unit per 50 videos
- **OpenAI API**: 3,000 requests/minute (org-level)
  - Embeddings: text-embedding-3-small
  - Classification: GPT-4o-mini (20 parallel calls max)
- **Replicate API**: 10 requests/second (adaptive)
- **Unified Endpoint**: 1,000 items per request maximum

## Migration Guide

### Converting Existing Endpoints

1. **Identify the import source type**
   - RSS feeds → `source: 'rss'`
   - Competitor channels → `source: 'competitor'`
   - Owner channels → `source: 'owner'`
   - Discovery system → `source: 'discovery'`

2. **Map input parameters**
   - Channel IDs → `channelIds`
   - Video IDs → `videoIds`
   - RSS URLs → `rssFeedUrls`

3. **Update API calls**
   ```javascript
   // Old
   await fetch('/api/youtube/import-competitor', { ... })
   
   // New
   await fetch('/api/video-import/unified', {
     method: 'POST',
     body: JSON.stringify({
       source: 'competitor',
       channelIds: [channelId],
       options: { batchSize: 50 }
     })
   })
   ```

4. **Handle response format changes**
   - New response includes `embeddingsGenerated` and `exportFiles`
   - Legacy responses can be mapped for backward compatibility

### Backward Compatibility

The system maintains backward compatibility by:
- Preserving existing API contracts
- Providing fallback mechanisms
- Mapping unified results to legacy formats
- Maintaining the same database schema

## Performance Optimization

### Batch Processing
- Videos processed in configurable batches (default: 50)
- Parallel embedding generation where possible
- Memory-efficient streaming for large datasets

### Caching Strategy
- Thumbnail embeddings cached locally (24-hour TTL)
- Database query result caching
- API response caching for repeated requests

### Resource Management
- Connection pooling for database operations
- Request throttling to respect API limits
- Memory cleanup after batch processing

## Monitoring & Observability

### Logging
- Structured logging with correlation IDs
- Performance metrics (processing time, throughput)
- Error tracking with stack traces
- API usage monitoring
- **Temporal Baseline Processing**: Logs automatic trigger after imports with video count

### Metrics
- Videos processed per hour
- Embedding generation success rates
- Classification success rates (topics and formats)
- Export file generation statistics
- Error rates by component
- **YouTube Quota Usage**: Real-time tracking in worker dashboard
- **OpenAI Token Usage**: Format classification cost tracking
- **Temporal Baseline Coverage**: Videos with channel_baseline_at_publish calculated
- **Temporal Performance Scores**: Distribution of performance ratios across channels

### Alerting
- API quota exhaustion warnings
- Processing failure alerts
- Performance degradation notifications
- Storage capacity monitoring
- **Quota Alerts**: Pre-flight checks prevent exceeding limits

## Security Considerations

### API Key Management
- Environment variables for sensitive data
- No API keys in client-side code
- Regular key rotation recommended

### Input Validation
- YouTube ID format validation
- URL sanitization for RSS feeds
- Request size limits (1,000 items max)
- Rate limiting per client

### Data Protection
- No sensitive data in logs
- Secure storage of embeddings
- Regular security audits
- Compliance with data retention policies

## Troubleshooting

### Common Issues

#### Cloudflare Blocking (Large Imports)
```javascript
// Error: "Sorry, you have been blocked" from Supabase API
// Cause: Cloudflare protection triggers on large batch inserts
// Solution 1: Ensure DATABASE_URL is configured for direct connection
// Solution 2: Reduce batch sizes if direct connection unavailable
options: { batchSize: 50 } // Smaller batches avoid Cloudflare

// System automatically handles this with three-tier approach:
// - 100+ videos → Direct database (bypasses Cloudflare)
// - 50-99 videos → Chunked API with delays
// - <50 videos → Standard API
```

#### YouTube API Quota Exceeded
```javascript
// Error: YouTube API quota exceeded
// Solution: Implement request queuing or reduce batch sizes
options: { batchSize: 25 }
```

#### Embedding Generation Failures
```javascript
// Error: OpenAI API rate limit
// Solution: Increase retry delays or reduce concurrency
options: { skipEmbeddings: true } // Temporarily skip if needed
```

#### Export File Permissions
```javascript
// Error: Cannot write to exports directory
// Solution: Ensure directory exists and has write permissions
mkdir -p exports
chmod 755 exports
```

### Performance Issues

#### Slow Processing
- Reduce batch sizes for memory-constrained environments
- Enable selective embedding generation
- Use local caching for repeated operations

#### High Memory Usage
- Process videos in smaller batches
- Clear cache between operations
- Monitor memory usage during large imports

## Development Guidelines

### Code Organization
- Keep embedding logic separate from import logic
- Use dependency injection for API clients
- Implement proper error boundaries
- Write comprehensive tests

### Testing Strategy
- Unit tests for individual components
- Integration tests for complete workflows
- Performance tests for large datasets
- Mock external API calls

### Deployment Considerations
- Environment-specific configuration
- Database migration scripts
- Monitoring setup
- Rollback procedures

## Known Issues & Recent Fixes

### Fixed Issues
1. **Topic Level IDs** (Fixed 2025-07-13)
   - Issue: Topic classifications weren't mapping to `topic_level_1/2/3` integer fields
   - Solution: Added regex extraction to parse IDs from BERTopic names (e.g., "topic_314" → 314)

2. **Thumbnail Embedding Tracking** (Fixed 2025-07-13)
   - Issue: Thumbnail embeddings generated but `thumbnail_embedding_version` not updated
   - Solution: Added `updateEmbeddingVersions()` method to track both title and thumbnail embeddings

3. **Temporal Baseline Processing Timeout** (Fixed 2025-08-08)
   - Issue: Batch processing function timing out after 167 seconds with large imports
   - Solution: Rewrote function to use single UPDATE with correlated subqueries instead of loops
   - Impact: Successfully processes batches of 100+ videos without timeouts

4. **Cloudflare Blocking on Large Imports** (Fixed 2025-08-14)
   - Issue: Bulk imports (1000+ videos) blocked by Cloudflare when using Supabase API
   - Root Cause: Supabase API endpoints protected by Cloudflare triggered on 500-video chunks
   - Solution: Implemented three-tier storage strategy with direct PostgreSQL connection for bulk ops
   - Impact: Successfully imports 1000+ videos using direct database connection, bypassing Cloudflare
   - Performance: ~27x faster than API calls, processes 500 videos per chunk without blocks

### Current Limitations
- Export files are typically skipped for RSS/competitor imports to prevent duplicates
- Baseline analytics integration requires additional configuration
- No real-time progress tracking for long-running imports

## Future Enhancements

### Planned Features
- Real-time progress tracking
- Advanced filtering options
- Bulk operation APIs
- Enhanced error recovery
- **Enhanced Classification**: 
  - Multi-format detection (primary and secondary)
  - Custom classification models per channel
  - Historical performance correlation
  - Automated reclassification for low-confidence videos

### Scalability Improvements
- Distributed processing
- Queue-based architecture
- Database sharding
- CDN integration

### Monitoring Enhancements
- Custom dashboards
- Performance analytics
- Cost optimization insights
- Predictive scaling

This documentation should be updated as the system evolves and new features are added.