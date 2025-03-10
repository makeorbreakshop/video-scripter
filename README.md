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