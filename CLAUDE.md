# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Commands
- **Development**: `npm run dev` - Start Next.js development server
- **Build**: `npm run build` - Build the application for production
- **Start**: `npm start` - Start production server
- **Lint**: `npm run lint` - Run Next.js linting

### Database Scripts
- **Database Info**: `node scripts/db-info.js` - Check database table structure
- **Setup Skyscraper Schema**: `node setup-skyscraper-schema-simple.js` - Initialize Skyscraper analysis schema
- **Check Supabase**: Open `check-supabase.html` in browser to test database connection

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
- **AI Integration**: OpenAI API and Anthropic Claude API
- **Styling**: Tailwind CSS with Radix UI components
- **Editor**: TipTap rich text editor

### Core Structure

#### Database Architecture
The application uses Supabase with multiple database schemas:
- **Core Tables**: `videos`, `chunks`, `analyses`, `patterns`, `scripts`
- **Skyscraper Framework**: `skyscraper_analyses` table stores comprehensive video analysis data
- **User Data**: `profiles`, `projects`, `documents`, `script_data`
- **Vector Database**: Integrated pgvector for semantic search and similarity matching

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
YOUTUBE_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
REPLICATE_API_TOKEN=
PINECONE_API_KEY=
PINECONE_INDEX_NAME=
PINECONE_THUMBNAIL_INDEX_NAME=
```

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

## Important Instruction Reminders

Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.