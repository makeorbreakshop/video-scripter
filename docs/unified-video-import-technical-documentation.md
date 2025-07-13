# Unified Video Import System - Technical Documentation

## Overview

The Unified Video Import System consolidates all video import mechanisms into a single, standardized service that handles metadata extraction, embedding generation, content classification, storage, and exports consistently across all import sources.

## Architecture

### Core Components

1. **Unified Service** (`/lib/unified-video-import.ts`)
   - `VideoImportService` class that handles all processing logic
   - Standardized interfaces for requests and responses
   - Integrated error handling and logging

2. **Unified API Endpoint** (`/app/api/video-import/unified/route.ts`)
   - Single POST endpoint for all import operations
   - Input validation and rate limiting
   - Comprehensive documentation via GET endpoint

3. **Updated Legacy Endpoints**
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
  options?: {
    skipEmbeddings?: boolean,
    skipExports?: boolean,
    skipThumbnailEmbeddings?: boolean,
    skipTitleEmbeddings?: boolean,
    skipClassification?: boolean,
    batchSize?: number,
    forceReEmbed?: boolean
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
  classificationsGenerated: {
    topics: number,
    formats: number
  },
  exportFiles: string[],
  errors: string[],
  processedVideoIds: string[],
  processingTime: number,
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

### 2. Embedding Generation

#### Title Embeddings
- **Model**: OpenAI `text-embedding-3-small`
- **Dimensions**: 512 (truncated from full embedding)
- **Purpose**: Semantic search and content similarity
- **Storage**: Pinecone main index (`youtube-titles-prod`)

#### Thumbnail Embeddings
- **Model**: Replicate CLIP `krthr/clip-embeddings`
- **Dimensions**: 768
- **Purpose**: Visual similarity search
- **Storage**: Pinecone thumbnail index (`video-thumbnails`)
- **Caching**: Local cache to reduce API costs

### 3. Content Classification

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

### 4. Data Storage

#### Supabase Database
```sql
-- Core video table structure
CREATE TABLE videos (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text,
  channel_id text NOT NULL,
  channel_name text,
  view_count bigint DEFAULT 0,
  published_at timestamptz,
  thumbnail_url text,
  performance_ratio numeric DEFAULT 1,
  data_source text DEFAULT 'competitor',
  is_competitor boolean DEFAULT true,
  import_date timestamptz DEFAULT now(),
  metadata jsonb,
  -- Classification fields
  topic_level_1 integer,
  topic_level_2 integer,
  topic_level_3 integer,
  topic_confidence numeric(3,2),
  format_type text,
  format_confidence numeric(3,2),
  format_reasoning text
);
```

#### Vector Storage
- **Pinecone Main Index**: Title embeddings (512D)
- **Pinecone Thumbnail Index**: Thumbnail embeddings (768D)
- **Local Cache**: Thumbnail embeddings with 24-hour TTL

#### Baseline Analytics Processing
- **Automatic Trigger**: Baseline processing automatically triggered after successful import
- **Batch Size**: Processes up to 1,000 videos per trigger
- **Scheduling**: Hourly cron job as safety net, immediate processing on import
- **Function**: `trigger_baseline_processing()` called with imported video count

### 5. Export System

#### Export Formats
- **JSON**: Full embeddings with metadata
- **CSV**: Tabular format for analysis
- **Metadata-Only**: Video information without embeddings

#### Export Locations
- **Directory**: `/exports/`
- **Naming**: `{type}-embeddings-{timestamp}.{format}`
- **Retention**: Files are kept indefinitely for backup/analysis

### 6. Error Handling

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
YOUTUBE_API_KEY=your_youtube_api_key
OPENAI_API_KEY=your_openai_api_key
REPLICATE_API_TOKEN=your_replicate_token

# Pinecone
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=youtube-titles-prod
PINECONE_THUMBNAIL_INDEX_NAME=video-thumbnails
```

### Rate Limits

- **YouTube API**: 10,000 units/day (optimized from 100 to 1 unit per channel)
  - channels.list: 1 unit
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
- **Baseline Processing**: Logs automatic trigger after imports

### Metrics
- Videos processed per hour
- Embedding generation success rates
- Classification success rates (topics and formats)
- Export file generation statistics
- Error rates by component
- **YouTube Quota Usage**: Real-time tracking in worker dashboard
- **OpenAI Token Usage**: Format classification cost tracking
- **Baseline Processing**: Videos pending baseline analytics

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