# Video Scripter Database Schema Documentation

## Overview

Video Scripter uses Supabase (PostgreSQL) with pgvector extension for comprehensive video analysis and content creation. The database contains **15 tables** organized around video processing, AI analysis, user management, and workflow management.

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

*Last updated: 2025-06-30*
*Database version: PostgreSQL with pgvector extension*
*Current tables: 15 (added baseline_analytics, daily_analytics)*
*Custom functions: 10 core functions + pgvector extensions*
*Materialized views: 1 (mv_makeorbreak_dashboard)*