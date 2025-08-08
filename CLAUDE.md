# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Commands
- **Development**: `npm run dev` - Start Next.js development server
- **Build**: `npm run build` - Build the application for production
- **Start**: `npm start` - Start production server
- **Lint**: `npm run lint` - Run Next.js linting

### Worker Commands (Background Processing)
- **All Workers**: `npm run workers:all` - Run all 6 workers concurrently
- **Vectorization Workers**: `npm run workers:vectorization` - Title & thumbnail embeddings
- **Classification Workers**: `npm run workers:classification` - Format & topic classification
- **Individual Workers**:
  - `npm run worker` - Video import worker
  - `npm run worker:title` - Title vectorization worker
  - `npm run worker:thumbnail` - Thumbnail vectorization worker
  - `npm run worker:format` - Format classification worker
  - `npm run worker:topic` - Topic classification worker
  - `npm run worker:classify` - Video classification worker
  - `npm run worker:view-tracking` - View tracking worker (tracks video performance over time)
  - `npm run worker:view-tracking:now` - Run view tracking immediately
  - `npm run worker:view-tracking:init` - Initialize view tracking priorities

### Database Scripts
- **Database Info**: `node scripts/db-info.js` - Check database table structure
- **Setup Skyscraper Schema**: `node setup-skyscraper-schema-simple.js` - Initialize Skyscraper analysis schema
- **Check Supabase**: Open `check-supabase.html` in browser to test database connection
- **Direct Database Updates**: `node scripts/direct-db-update.js` - Perform bulk updates via direct connection (bypasses timeouts)

### MCP Tools Available
- **Supabase MCP**: Direct database access via MCP tools including:
  - `mcp__supabase__execute_sql` - Execute raw SQL queries for data analysis
  - `mcp__supabase__list_tables` - List all database tables
  - `mcp__supabase__apply_migration` - Apply database migrations
  - `mcp__supabase__get_advisors` - Check for security/performance issues
  - All other Supabase management operations

## Application Architecture

### Tech Stack
- **Framework**: Next.js 15 with App Router
- **Database**: Supabase (PostgreSQL with pgvector for embeddings)
- **Authentication**: Supabase Auth with OAuth
- **AI Integration**: OpenAI API, Anthropic Claude API, Replicate (CLIP embeddings)
- **Vector Database**: Pinecone for distributed embeddings storage
- **Styling**: Tailwind CSS with Radix UI components
- **Editor**: TipTap rich text editor
- **Background Processing**: 6 concurrent workers for import, vectorization, and classification

### Core Structure

#### Database Architecture
The application uses Supabase with 17 core tables and 7 materialized views:
- **Content Tables**: `videos`, `chunks`, `comments`, `patterns`, `scripts`
- **Analytics Tables**: `baseline_analytics`, `daily_analytics` - YouTube performance metrics
- **AI Analysis**: `skyscraper_analyses`, `analyses` - Comprehensive video analysis data
- **User Management**: `profiles`, `projects`, `documents`, `script_data`
- **System Tables**: `jobs`, `youtube_quota_usage`, `youtube_quota_calls` - Worker and quota tracking
- **Vector Storage**: Integrated pgvector + external Pinecone for embeddings
- **Materialized Views**: Performance-optimized views with pg_cron refresh (300x speedup)

#### Application Flow
1. **YouTube Video Processing**: Videos are analyzed using YouTube Data API and transcripts are chunked for processing
2. **AI Analysis Pipeline**: Multiple AI models (OpenAI, Anthropic) analyze content using the "Skyscraper" framework
3. **5-Phase Workflow**: Research → Packaging → Scripting → Refinement → Export
4. **Vector Search**: Semantic search across video content using OpenAI embeddings

### Key Directories

#### `/app` - Next.js App Router
- **API Routes**: `/app/api/` contains all backend endpoints
  - `/video-import/unified/` - **NEW**: Unified video import endpoint (consolidates all import mechanisms)
  - `/vector/` - Video processing and vector operations
  - `/skyscraper/` - Skyscraper analysis endpoints
  - `/youtube/` - YouTube Data API integration (legacy endpoints updated to use unified system)
- **Pages**: Dashboard, database management, analysis views
- **Components**: Shared UI components specific to app routes

#### `/components` - Reusable Components
- **Phase Editors**: Individual editors for each workflow phase
- **Phase Tools**: Tool panels for each workflow phase
- **UI Components**: Radix UI-based component library in `/ui/`

#### `/lib` - Core Services
- **API Clients**: `anthropic-api.ts`, `openai-api.ts`, `youtube-api.ts`
- **Database Services**: `supabase-*.ts`, `vector-db-service.ts`, `skyscraper-db-service.ts`
- **Processing**: `video-processor.ts`, `transcript-chunker.ts`, `enhanced-video-processor.ts`
- **Unified Import**: `unified-video-import.ts` - **NEW**: Consolidated video import service

#### `/types` - TypeScript Definitions
- `database.ts` - Supabase database types
- `skyscraper.ts` - Skyscraper analysis framework types
- `workflow.ts` - Workflow and phase types

### Environment Variables Required
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL= # Direct database connection for bulk operations
YOUTUBE_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
REPLICATE_API_TOKEN=
PINCONE_API_KEY=
PINCONE_INDEX_NAME=
PINCONE_THUMBNAIL_INDEX_NAME=
PINCONE_SUMMARY_INDEX_NAME=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
YOUTUBE_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
REPLICATE_API_TOKEN=
PINECONE_API_KEY=
PINECONE_INDEX_NAME=
PINECONE_THUMBNAIL_INDEX_NAME=
PINECONE_SUMMARY_INDEX_NAME=
```

### Recent Updates (2025)

#### Video Classification System
- **Format Classification**: 12 content formats using GPT-4o-mini ($0.06/1K videos)
- **Topic Classification**: 777 BERTopic clusters with 3-level hierarchy (local processing)
- **Confidence Tracking**: Low-confidence reclassification support
- **Auto-Runner Component**: `<ReclassificationRunner />` for continuous processing

#### YouTube Quota Management
- **Pacific Time Tracking**: Quota resets at midnight PT (UTC-8)
- **Pre-flight Checks**: Prevents quota overruns before API calls
- **Detailed Logging**: `youtube_quota_calls` table tracks every API request
- **Worker Integration**: Real-time quota display in worker dashboard

#### Performance Optimizations
- **Materialized Views**: 300x query performance improvement
- **Batch Processing**: 500+ videos/minute for topic classification
- **Adaptive Rate Limiting**: Intelligent throttling for external APIs
- **Worker Concurrency**: 6 parallel workers for different processing stages

### View Tracking System

#### Overview
The view tracking system monitors video performance over time to enable age-adjusted performance metrics and detect viral content early. It tracks ~100,000 videos daily within YouTube API quota limits.

#### Database Schema
- **view_snapshots**: Time-series data for video views, likes, comments
- **view_tracking_priority**: Priority assignments for tracking frequency
- **video_performance_trends**: Materialized view with calculated metrics

#### Priority Tiers
- **Tier 1 (Daily)**: New videos (<30 days) and high performers
- **Tier 2 (Every 3 days)**: Medium-age videos (30-180 days)
- **Tier 3 (Weekly)**: Older videos for baseline data

#### Key Features
- **Batch API Calls**: 50 videos per call (2,000 calls = 100,000 videos)
- **Self-Managing**: Automatic priority adjustments via database triggers
- **Historical Preservation**: Initial snapshots use import_date, not current date
- **Manual Triggering**: Dashboard button for daily runs (no automated cron yet)

#### Usage
1. **Manual Trigger**: Click "Run Daily Tracking" in worker dashboard
2. **Monitor Progress**: Check `/api/view-tracking/stats` for real-time updates
3. **View Data**: Query `view_snapshots` table or `video_performance_trends` view

#### Maintenance
- **Materialized View Refresh**: pg_cron job runs daily at 2 AM PT
- **Snapshot Cleanup**: Monthly removal of snapshots >1 year old
- **Priority Updates**: Automatic via `update_view_tracking_priority_on_video_update` trigger

### Key Features

#### Skyscraper Analysis Framework
- Comprehensive video content analysis using structured AI prompts
- Analyzes content gaps, audience engagement, structure elements
- Stores results in JSONB format for flexible querying
- Supports streaming analysis with progress tracking

#### Vector Database Integration
- Uses OpenAI embeddings for semantic search
- Chunks video transcripts for efficient processing
- Supports bulk processing and similarity matching
- Integrated with Supabase pgvector extension

#### YouTube Integration
- OAuth authentication for accessing private data
- Video metadata extraction and transcript downloading
- Batch processing capabilities for multiple videos
- Comment analysis and engagement metrics

#### Unified Video Import System
- **Single Endpoint**: `/api/video-import/unified` consolidates all import mechanisms
- **Multiple Sources**: Supports competitor, discovery, RSS, owner, and sync imports
- **Complete Pipeline**: Handles metadata extraction, embeddings, storage, and exports
- **Dual Embeddings**: Title embeddings (OpenAI 512D) and thumbnail embeddings (Replicate CLIP 768D)
- **Local Exports**: Automatic generation of JSON/CSV exports in `/exports/` directory
- **Backward Compatibility**: Legacy endpoints updated to use unified system with fallback support

### Direct Database Connection

#### Setup
1. Get connection string from Supabase Dashboard > Settings > Database > Connection String (URI)
2. Use the pooler connection (port 6543) for better handling of bulk operations
3. Add to .env as: `DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`

#### Usage for Bulk Operations
- **Generate SQL**: `node scripts/direct-db-update.js --generate-sql`
- **Execute directly**: `node scripts/direct-db-update.js`
- Bypasses all Supabase timeouts (SQL Editor: 15s, API: 8s-2min)
- Essential for operations affecting thousands of rows

## Development Notes

### Database Schema Management
- Use the provided SQL files in `/sql/` for schema setup
- The application supports multiple schema versions (simple and complex)
- Skyscraper analysis data is stored as JSONB for flexibility

### AI Model Integration
- OpenAI integration handles embeddings and general AI tasks
- Anthropic Claude integration focuses on content analysis
- Token counting and cost tracking implemented for both APIs

### Video Processing Pipeline
1. Video metadata extraction via YouTube API
2. Transcript downloading and chunking
3. Vector embedding generation (titles and thumbnails)
4. AI analysis using multiple models
5. Results storage in structured format
6. **NEW**: Unified processing via `/api/video-import/unified` endpoint

### Unified Video Import Usage
```javascript
// Example: Import competitor videos with full processing
const response = await fetch('/api/video-import/unified', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    source: 'competitor',
    channelIds: ['UC6107grRI4m0o2-emgoDnAA'],
    options: {
      batchSize: 50,
      skipEmbeddings: false,
      skipExports: false
    }
  })
});
```

### Authentication Flow
- Supabase Auth with OAuth providers
- User profiles automatically created on first login
- Row-level security policies implemented for data isolation

### Testing & Validation
When making changes to the codebase:
1. **Run TypeScript checks**: The project uses TypeScript - ensure no type errors
2. **Test API endpoints**: Use the app's UI or direct API calls to verify functionality
3. **Check worker logs**: Monitor worker output when testing background processing
4. **Verify database changes**: Use MCP tools to confirm data integrity
5. **Check quota usage**: Monitor `youtube_quota_usage` table for API consumption

### Common Debugging Endpoints
- `/api/classification/count-low-confidence` - Check videos needing reclassification
- `/api/youtube/quota/check` - Current YouTube API quota status
- `/api/view-tracking/stats` - View tracking statistics and tier distribution
- `/api/view-tracking/run` - Manually trigger view tracking (POST)
- `/app/dashboard/youtube/categorization` - Visual classification overview
- `/app/dashboard/youtube/worker` - Worker dashboard with view tracking controls

## Important Instruction Reminders

Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.

### SQL Delivery Instructions
When providing SQL to the user for Supabase:
- ALWAYS provide SQL statements ONE AT A TIME
- Wait for user confirmation after each SQL statement
- Never combine multiple SQL operations in a single response
- User needs to run each statement individually in Supabase SQL Editor