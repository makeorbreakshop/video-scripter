# Video Scripter Database Schema Documentation

## Overview

Video Scripter uses Supabase (PostgreSQL) with pgvector extension for comprehensive video analysis and content creation. The database contains **16 tables** organized around video processing, AI analysis, user management, and workflow management.

**Key Statistics:**
- 328 videos currently stored
- 5,337 transcript chunks processed  
- 42 Skyscraper analyses completed
- Vector embeddings for semantic search

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

---

*Last updated: 2025-06-25*
*Database version: PostgreSQL with pgvector extension*