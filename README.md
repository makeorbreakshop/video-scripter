# YouTube Script Editor

A Next.js application for creating and managing YouTube video scripts with a structured workflow.

## Setup Instructions

### Prerequisites

- Node.js 16+ and npm
- Supabase account for authentication and database
- YouTube Data API key (for video analysis features)
- OpenAI API key (for AI assistance features)

### Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Create a `.env.local` file in the root directory with your credentials:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here

# YouTube Data API key for video analysis
YOUTUBE_API_KEY=your_youtube_api_key_here

# OpenAI API key for AI features
OPENAI_API_KEY=your_openai_api_key_here
```

4. Start the development server:
```bash
npm run dev
```

### API Keys Setup

1. **Supabase**: Create a project at [supabase.com](https://supabase.com) and copy your URL and anon key
2. **YouTube Data API**: Get an API key from the [Google Cloud Console](https://console.cloud.google.com)
   - Create a new project
   - Enable the YouTube Data API v3
   - Create credentials for an API key
3. **OpenAI API**: Sign up at [openai.com](https://openai.com) and get your API key from the dashboard

### Supabase Setup

1. Create a new Supabase project
2. Set up the following tables in your Supabase database:
   - `projects`: Stores user projects
   - `documents`: Stores documents (notes, scripts, etc.)
   - `script_data`: Stores structured data for each phase of the script creation workflow

3. Create the necessary authentication providers in your Supabase project settings

### Development

The application follows a 5-phase workflow for creating YouTube scripts:

1. **Research**: Collect and analyze YouTube videos
2. **Packaging**: Develop titles and thumbnail concepts
3. **Scripting**: Write the actual script content
4. **Refinement**: Polish and improve the script
5. **Export**: Format and export the final script

Refer to the code documentation for details on implementation.

## Updated Repository
This repository has been updated and is now properly deployed to GitHub.

## Database Access

The application connects to a Supabase database with the following structure:

### Tables

1. `videos` - Stores YouTube video metadata
2. `chunks` - Stores transcript chunks for videos
3. `analyses` - General analysis results
4. `patterns` - Content pattern data
5. `scripts` - Script content
6. `skyscraper_analyses` - Detailed analyses using the Skyscraper framework
7. `profiles` - User profiles
8. `projects` - Project data
9. `documents` - Document storage
10. `script_data` - Script-related structured data

### Database Access via MCP

AI assistants (Claude) can access the database directly through MCP integration using read-only SQL queries. This allows for:

- Checking saved analysis results
- Viewing database structure
- Verifying data integrity
- Providing insights based on stored data

Example database query through MCP:
```sql
SELECT id, video_id, model_used, created_at FROM skyscraper_analyses ORDER BY created_at DESC LIMIT 5;
```

### Skyscraper Analysis Schema

The `skyscraper_analyses` table stores comprehensive video analyses with the following structure:

```sql
CREATE TABLE IF NOT EXISTS public.skyscraper_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id TEXT NOT NULL,
  content_analysis JSONB,
  audience_analysis JSONB,
  content_gaps JSONB,
  structure_elements JSONB,
  engagement_techniques JSONB,
  value_delivery JSONB,
  implementation_blueprint JSONB,
  model_used TEXT,
  tokens_used INTEGER,
  cost DOUBLE PRECISION,
  status TEXT,
  progress INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  user_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

For more detailed schema information, see [skyscraper-schema-simple-README.md](./skyscraper-schema-simple-README.md). 