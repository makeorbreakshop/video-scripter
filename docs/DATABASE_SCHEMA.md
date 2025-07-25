# Video Scripter Database Schema Documentation

## Overview

Video Scripter uses Supabase (PostgreSQL) with pgvector extension for comprehensive video analysis and content creation. The database contains **17 tables** organized around video processing, AI analysis, user management, workflow management, and API quota tracking.

**Key Features:**
- YouTube Analytics data collection (daily and baseline)
- Vector embeddings for semantic search
- Comprehensive video analysis pipeline
- User management with Row Level Security

## Core Tables

### Videos (`videos`)
**Primary content table storing YouTube video metadata**
- **Primary Key**: `id` (text) - YouTube video ID
- **Key Columns**: `title`, `description`, `channel_id`, `view_count`, `published_at`
- **Analytics**: `performance_ratio`, `outlier_factor`, `channel_avg_views`, `niche`
- **JSONB**: `metadata` - Additional video data like tags and categories
- **Relationships**: Referenced by chunks, analyses, patterns, comments, skyscraper_analyses

### Chunks (`chunks`) 
**Processed video transcript segments with embeddings**
- **Primary Key**: `id` (uuid)
- **Key Columns**: `video_id`, `content`, `content_type`, `start_time`, `end_time`
- **Vector**: `embedding` (vector) - OpenAI embeddings for semantic search
- **JSONB**: `metadata` - Additional chunk processing data
- **Purpose**: Enables semantic search across video content

### Baseline Analytics (`baseline_analytics`)
**Lifetime cumulative analytics for each video (one-time establishment)**
- **Primary Key**: `id` (uuid)
- **Key Columns**: `video_id`, `baseline_date`, `views`, `engaged_views`, `estimated_minutes_watched`
- **Engagement Metrics**: `likes`, `comments`, `shares`, `subscribers_gained`, `subscribers_lost`
- **Revenue Metrics**: `estimated_revenue`, `estimated_ad_revenue`, `cpm`, `monetized_playbacks`
- **Device Breakdown**: `mobile_views`, `desktop_views`, `tablet_views`, `tv_views`
- **Traffic Sources**: `search_views`, `suggested_views`, `external_views`, `direct_views`, `channel_views`, `playlist_views`
- **Cards & Annotations**: Comprehensive click rates and impression data
- **JSONB Fields**: `country_views`, `top_age_groups`, `gender_breakdown` for demographic analysis
- **Purpose**: Establishes baseline performance for calculating daily deltas and performance ratios

### Daily Analytics (`daily_analytics`)
**Day-by-day YouTube Analytics API data for comprehensive performance tracking**
- **Primary Key**: `id` (uuid)
- **Key Columns**: `video_id`, `date`, `views`, `estimated_minutes_watched`, `average_view_duration`
- **View Metrics**: `engaged_views`, `red_views`, `viewer_percentage`, `average_view_percentage`
- **Engagement Metrics**: `likes`, `dislikes`, `comments`, `shares`, `subscribers_gained`, `subscribers_lost`
- **Playlist Metrics**: `videos_added_to_playlists`, `videos_removed_from_playlists`
- **Revenue Metrics**: `estimated_revenue`, `estimated_ad_revenue`, `estimated_red_partner_revenue`, `gross_revenue`
- **Ad Performance**: `cpm`, `playback_based_cpm`, `ad_impressions`, `monetized_playbacks`
- **Card & Annotation Metrics**: Complete click-through and impression data
- **JSONB Fields**: `audience_watch_ratio`, `relative_retention_performance` for advanced analytics
- **Purpose**: Enables trend analysis, performance tracking, and data-driven content optimization

### Skyscraper Analyses (`skyscraper_analyses`)
**Comprehensive AI analysis using the Skyscraper framework**
- **Primary Key**: `id` (uuid)  
- **Key Columns**: `video_id`, `status`, `progress`, `model_used`, `tokens_used`, `cost`
- **Analysis JSONB Fields**:
  - `content_analysis` - Key points, visual elements, technical info, structure
  - `audience_analysis` - Target audience insights
  - `content_gaps` - Missing content opportunities
  - `structure_elements` - Video organization analysis
  - `engagement_techniques` - Audience engagement methods
  - `value_delivery` - Content value assessment
  - `implementation_blueprint` - Actionable insights
- **Processing**: `started_at`, `completed_at` for tracking analysis lifecycle

### Analyses (`analyses`)
**General AI analysis results for videos**
- **Primary Key**: `id` (uuid)
- **Key Columns**: `video_id`, `phase` (integer), `content`, `tokens_used`, `cost`
- **Vector**: `embedding` (vector) - Analysis embeddings
- **JSONB**: `metadata` - Analysis-specific data
- **Purpose**: Stores phase-based workflow analysis results

## User & Project Management

### Profiles (`profiles`)
**User profile information with RLS enabled**
- **Primary Key**: `id` (uuid) - Links to auth.users
- **Key Columns**: `username`, `full_name`, `email`, `avatar_url`
- **Security**: Row Level Security (RLS) enabled
- **Relationship**: One-to-one with Supabase auth.users

### Projects (`projects`)
**Project organization for users**
- **Primary Key**: `id` (uuid)
- **Key Columns**: `name`, `user_id`
- **Relationships**: Referenced by documents and script_data

### Documents (`documents`) 
**Project documents and files**
- **Primary Key**: `id` (uuid)
- **Key Columns**: `title`, `type`, `content`, `project_id`, `user_id`
- **Purpose**: Stores user-created documents within projects

### Script Data (`script_data`)
**Workflow script data storage**
- **Primary Key**: `id` (uuid)
- **Key Columns**: `project_id`, `user_id`
- **JSONB**: `data` - Complex workflow data including research, packaging, scripting phases
- **Structure Example**: Research notes, video analysis, packaging ideas, script outlines, refinement feedback

## Content Analysis & Patterns

### Comments (`comments`)
**YouTube video comments with threading**
- **Primary Key**: `id` (uuid) 
- **Key Columns**: `video_id`, `comment_id` (YouTube ID), `author_name`, `content`
- **Threading**: `parent_comment_id`, `is_reply`, `reply_depth`
- **Engagement**: `likes_count`, `published_at`
- **JSONB**: `metadata` - Additional comment data

### Patterns (`patterns`)
**Identified content patterns across videos**
- **Primary Key**: `id` (uuid)
- **Key Columns**: `video_id`, `pattern_type`, `user_id`
- **JSONB**: `pattern_data` - Structured pattern information
- **Purpose**: Stores recurring themes and content patterns

## System & Workflow Management

### Jobs (`jobs`)
**Background job processing with RLS**
- **Primary Key**: `id` (uuid)
- **Key Columns**: `type`, `status` (enum: pending/processing/completed/failed), `user_id`
- **Progress**: `progress`, `processed_count`, `total_count`
- **Data**: `data` (jsonb), `processed_items` (jsonb)
- **Status**: `message`, `error` for job tracking

### Scripts (`scripts`)
**Published script content with RLS**
- **Primary Key**: `id` (uuid)
- **Key Columns**: `title`, `user_id`, `is_published`, `youtube_video_id`
- **JSONB**: `content` - Rich script content
- **Security**: Row Level Security enabled

## Specialized Tables

### Ink Test Data (`ink_test_data`)
**Specialized table for ink/printing analysis with RLS**
- **Primary Key**: `id` (uuid)
- **Key Columns**: `ink_mode`, `quality` (enum: draft/standard/high), `image_type`
- **JSONB Fields**: `dimensions`, `channel_ml` - Technical printing data
- **Purpose**: Supports specialized printing/ink analysis features

## API Quota Management

### YouTube Quota Usage (`youtube_quota_usage`)
**Tracks daily YouTube API quota consumption**
- **Primary Key**: `date` (date) - Pacific Time date
- **Key Columns**: 
  - `quota_used` (integer) - Units consumed today
  - `quota_limit` (integer) - Daily limit (default: 10,000)
  - `last_reset` (timestamptz) - Last reset timestamp
- **Timestamps**: `created_at`, `updated_at`
- **Purpose**: Prevents exceeding YouTube's 10,000 daily unit limit
- **Reset**: Automatic at midnight Pacific Time via pg_cron

### YouTube Quota Calls (`youtube_quota_calls`)
**Detailed log of individual YouTube API calls**
- **Primary Key**: `id` (serial)
- **Key Columns**:
  - `date` (date) - Pacific Time date
  - `method` (text) - API method called (e.g., 'videos.list', 'search.list')
  - `cost` (integer) - Quota units consumed
  - `description` (text) - Human-readable description
  - `job_id` (text) - Associated processing job ID
- **Timestamp**: `created_at`
- **Indexes**: On date, method, and job_id for performance
- **Purpose**: Detailed tracking and analysis of API usage patterns

## Key JSONB Structures

### Skyscraper Analysis Content Analysis
```json
{
  "key_points": [
    {
      "point": "Description",
      "timestamp": "0:45", 
      "elaboration": "Detailed explanation"
    }
  ],
  "visual_elements": [
    {
      "element": "Element type",
      "purpose": "Why it's used"
    }
  ],
  "technical_information": [
    {
      "topic": "Topic name",
      "details": "Technical details"
    }
  ],
  "structural_organization": [
    {
      "title": "Section name",
      "start_time": "0:00",
      "end_time": "0:15", 
      "description": "Section purpose"
    }
  ]
}
```

### Script Data Workflow Structure
```json
{
  "research": {
    "notes": "",
    "summary": "",
    "analysis": {
      "isProcessed": false,
      "commonQuestions": [],
      "contentCoverage": [],
      "audienceReactions": []
    },
    "documents": [],
    "videoUrls": []
  },
  "packaging": {
    "ideas": [],
    "titles": [],
    "thumbnailConcepts": []
  },
  "scripting": {
    "introBrick": {},
    "middleBricks": [],
    "endBrick": {}
  },
  "refinement": {
    "feedback": [],
    "checklist": {}
  }
}
```

## Database Architecture

### Vector Database Integration
- **pgvector Extension**: Enabled for semantic search
- **Embeddings**: OpenAI embeddings stored in `vector` columns
- **Search Capability**: Semantic search across video content and analyses

### Foreign Key Relationships
- All content tables → `videos.id`
- All user-owned tables → `auth.users.id` 
- Documents/script_data → `projects.id`
- Comments support hierarchical threading

### Row Level Security (RLS)
**Enabled on tables**: `profiles`, `jobs`, `scripts`, `ink_test_data`
**Purpose**: Ensures users can only access their own data

### Performance Considerations
- Primary keys on all tables (UUID or text)
- Foreign key constraints for data integrity
- Indexes on frequently queried columns
- JSONB for flexible, queryable document storage

## Materialized Views for Dashboard Performance

### analytics_stats
**Purpose**: Provides aggregated statistics across the video database
- **Content**: Total videos, competitor videos, embedded videos, recent videos, average views
- **Channel Stats**: Total channels, competitor channels, RSS monitored channels
- **Refresh Schedule**: Hourly via `refresh_analytics_stats()` function

### channel_network_centrality
**Purpose**: Analyzes channel discovery patterns and relationships
- **Key Metrics**: Discovery frequency, method diversity, average relevance score
- **Discovery Methods**: Tracks how channels are discovered and connected
- **Usage**: Helps identify influential channels in the network

### competitor_channel_summary
**Purpose**: Aggregates competitor channel data for quick access
- **Content**: Channel metadata, subscriber counts, video counts, last import dates
- **Optimization**: Uses best available metadata from videos
- **Refresh Schedule**: Daily at 3 AM via `refresh_competitor_channel_summary()` function

### mv_makeorbreak_dashboard
**Purpose**: Pre-calculated metrics for the Make or Break Shop channel dashboard
- **Performance Metrics**: View counts, performance ratios, revenue data
- **Categories**: Classifies videos as excellent/good/average/poor based on performance
- **Optimization**: Handles duplicate baseline entries, pre-calculates recent averages
- **Impact**: Reduced query time from 40ms+ to 0.121ms

### packaging_performance
**Purpose**: Optimized view for packaging analysis page
- **Content**: Video performance metrics excluding YouTube Shorts
- **Features**: Performance ratios, channel baselines, video metadata
- **Refresh Schedule**: Daily at 2 AM
- **Usage**: Powers the packaging analysis dashboard

### unprocessed_thumbnails & videos_2024_unprocessed
**Purpose**: Track videos pending thumbnail embedding processing
- **Content**: Videos with thumbnail URLs but no embeddings
- **Filtering**: `videos_2024_unprocessed` focuses on 2024 content only
- **Usage**: Feeds thumbnail processing pipelines

## Scheduled Jobs (Cron)

### Daily Jobs

#### daily-packaging-refresh (2:00 AM)
- **Command**: `REFRESH MATERIALIZED VIEW packaging_performance;`
- **Purpose**: Updates packaging dashboard data for optimal performance

#### refresh-competitor-channels (3:00 AM)
- **Command**: `SELECT refresh_competitor_channel_summary();`
- **Purpose**: Updates competitor channel summary with latest data

### Hourly Jobs

#### refresh-analytics-stats (Every hour)
- **Command**: `SELECT refresh_analytics_stats();`
- **Purpose**: Updates analytics statistics materialized view

### High-Frequency Jobs

#### baseline-processing (Every 30 seconds)
- **Command**: `SELECT process_baseline_batch(1000);`
- **Purpose**: Processes baseline analytics in batches for new videos
- **Active**: Currently running to handle analytics backlog

#### youtube-quota-reset-check (Every hour)
- **Command**: `SELECT reset_youtube_quota_if_needed();`
- **Purpose**: Ensures quota tracking aligns with YouTube's Pacific Time reset
- **Features**: Creates daily records, cleans up old data

#### youtube-quota-midnight-reset (Every 5 minutes from 11 PM - 12 AM PT)
- **Command**: Pacific Time aware quota reset check
- **Purpose**: Aggressive checking around midnight PT to catch reset
- **Schedule**: Runs every 5 minutes during hours 23 and 0

## Custom Database Functions

### YouTube Analytics Functions
- **`get_distinct_analytics_dates()`**: Returns all distinct dates from daily_analytics table
  - **Purpose**: Efficiently retrieves existing analytics dates for Smart Suggestions UI
  - **Security**: SECURITY DEFINER to bypass client row limits
  - **Usage**: Supports backward fill recommendations and data coverage analysis

### Video Search Functions
- **`search_video_by_id()`**: Enhanced video search by ID
- **`search_video_chunks()`**: Semantic search across video transcript chunks
- **`search_video_chunks_no_auth()`**: Public video chunk search
- **`search_analyses()`**: Search across AI analysis results

### Workflow & Script Functions
- **`create_default_script_data()`**: Initializes default script workflow data structure
- **`update_updated_at_column()`**: Automatically updates timestamp columns
- **`update_job_updated_at()`**: Updates job table timestamps
- **`update_baseline_analytics_updated_at()`**: Updates baseline analytics timestamps

### Analytics & Performance Functions
- **`refresh_analytics_cache()`**: Refreshes cached analytics data for performance
- **`calculate_channel_baseline()`**: Calculates average views baseline for a channel
- **`update_performance_ratios()`**: Updates performance_ratio column for all videos in a channel

### Materialized View Refresh Functions
- **`refresh_analytics_stats()`**: Updates the analytics_stats materialized view
  - **Schedule**: Runs hourly via cron job
  - **Purpose**: Keeps video and channel statistics current
- **`refresh_competitor_channel_summary()`**: Updates competitor channel aggregations
  - **Schedule**: Runs daily at 3 AM
  - **Security**: SECURITY DEFINER for proper permissions
- **`refresh_dashboard_data()`**: General dashboard refresh function
- **`refresh_network_centrality()`**: Updates channel network analysis view

### Dashboard Support Functions
- **`get_packaging_performance()`**: Retrieves filtered packaging performance data
  - **Parameters**: search_term, competitor_filter, date_filter, performance_filter, sort options, pagination
  - **Usage**: Powers the packaging analysis page with sorting and filtering
- **`get_competitor_channel_stats()`**: Returns competitor channel statistics
- **`get_youtube_channel_ids()`**: Retrieves all YouTube channel IDs in the system

### YouTube Quota Management Functions
- **`increment_quota_usage(cost)`**: Increments daily quota usage by cost amount
  - **Returns**: Current total usage for the day
  - **Uses**: Pacific Time for date calculations
- **`log_youtube_api_call(method, cost, description, job_id)`**: Logs individual API calls
  - **Purpose**: Detailed tracking with method, cost, and context
  - **Auto-increments**: Daily quota usage
- **`get_quota_status()`**: Returns current quota status as JSON
  - **Fields**: date, quota_used, quota_limit, quota_remaining, percentage_used
  - **Pacific Time**: Includes hours_until_reset calculation
- **`check_quota_available(estimated_cost)`**: Pre-flight quota check
  - **Returns**: Boolean indicating if quota is available
  - **Purpose**: Prevents operations that would exceed daily limit
- **`reset_youtube_quota_if_needed()`**: Maintains quota tracking system
  - **Features**: Creates daily records, cleans up old data (30+ days)
  - **Pacific Time**: All date calculations use America/Los_Angeles
- **`check_quota_cron_status()`**: Monitor quota cron job health
  - **Returns**: Job status, schedule, last/next run times

## YouTube Analytics Architecture

### Data Collection Strategy
The YouTube Analytics system operates on a two-tier approach:

1. **Baseline Analytics**: One-time collection of lifetime cumulative metrics for each video
   - Establishes historical performance baseline
   - Comprehensive demographic and device breakdowns
   - Used for performance ratio calculations

2. **Daily Analytics**: Ongoing collection of day-by-day performance data
   - Enables trend analysis and performance tracking
   - Supports rate limiting optimization (80% API utilization target)
   - Provides granular insights for content optimization

### Smart Suggestions Integration
The `get_distinct_analytics_dates()` function powers the Smart Suggestions UI component, providing:
- Data coverage analysis with gap detection
- Backward fill recommendations based on data age
- Intelligent batch size and utilization target suggestions
- Time estimates based on proven performance metrics (34,100 videos/hour)

## YouTube API Quota Optimization (2025-07-11)

Implemented comprehensive quota tracking system with 96% reduction in API usage:

### Quota Tracking Infrastructure
- Added `youtube_quota_usage` and `youtube_quota_calls` tables
- Pacific Time aware tracking aligned with YouTube's reset schedule
- Pre-flight quota checks prevent exceeding 10,000 daily unit limit
- Automatic cleanup of records older than 30 days

### API Usage Optimization
**Before**: Using `search.list` (100 units per call)
**After**: Using `playlistItems.list` (1 unit per call)
**Impact**: 309 units → 11 units for ~100 video channel import

### Quota Management Benefits
- Can now import ~900 channels/day vs ~32 previously
- Real-time monitoring via worker dashboard integration
- Detailed API call logging with job tracking
- Automatic reset handling via pg_cron jobs

## Performance Optimizations (2025-06-30)

### Database Performance Enhancement
Major performance optimizations implemented achieving **300x query improvement** (40ms → 0.121ms):

#### Strategic Indexes for Analytics Queries
```sql
-- Core performance indexes for analytics workloads
CREATE INDEX idx_videos_channel_published ON videos(channel_id, published_at DESC);
CREATE INDEX idx_videos_channel_views ON videos(channel_id, view_count DESC);
CREATE INDEX idx_daily_analytics_video_date_views ON daily_analytics(video_id, date DESC, views);
```

#### Performance Ratio Calculation System
- Added `performance_ratio` column to videos table for database-level calculations
- Eliminated frontend baseline recalculation overhead
- Channel baseline functions for automated ratio updates

#### Materialized View for Dashboard Performance
Created `mv_makeorbreak_dashboard` materialized view:
- Pre-calculated performance metrics and categories
- Handles duplicate baseline entries using `DISTINCT ON`
- Optimized for packaging analysis dashboard
- Supports instant filtering and sorting operations

**Impact**: Packaging API queries reduced from 40ms+ to 0.121ms execution time

---

*Last updated: 2025-07-11*
*Database version: PostgreSQL with pgvector extension*
*Current tables: 17 (added youtube_quota_usage, youtube_quota_calls)*
*Custom functions: 24+ functions including quota management*
*Materialized views: 7 (analytics_stats, channel_network_centrality, competitor_channel_summary, mv_makeorbreak_dashboard, packaging_performance, unprocessed_thumbnails, videos_2024_unprocessed)*
*Scheduled cron jobs: 6 (added youtube-quota-reset-check, youtube-quota-midnight-reset)*