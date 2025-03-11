# Database Access Guidelines

This document provides comprehensive guidelines for working with the Supabase database in the Video Scripter application, including access methods, schema details, and best practices.

## Database Schema

The application uses the following tables:

| Table Name | Description | Primary Key |
|------------|-------------|------------|
| `videos` | YouTube video metadata | `id` (YouTube ID) |
| `chunks` | Transcript chunks for videos | `id` (UUID) |
| `analyses` | General video analyses | `id` (UUID) |
| `patterns` | Content pattern data | `id` (UUID) |
| `scripts` | Script content | `id` (UUID) |
| `skyscraper_analyses` | Detailed Skyscraper framework analyses | `id` (UUID) |
| `profiles` | User profiles | `id` (UUID) |
| `projects` | Project data | `id` (UUID) |
| `documents` | Document storage | `id` (UUID) |
| `script_data` | Script-related structured data | `id` (UUID) |

## Access Methods

### 1. MCP Integration (for AI Assistants)

Claude and other AI assistants can access the database directly through MCP integration with read-only SQL queries.

**Example queries:**

```sql
-- List all tables
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

-- View table structure
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'skyscraper_analyses';

-- Query recent analyses
SELECT id, video_id, model_used, created_at FROM skyscraper_analyses ORDER BY created_at DESC LIMIT 5;

-- Check analysis components
SELECT id, video_id, 
  (content_analysis IS NOT NULL) as has_content_analysis,
  (audience_analysis IS NOT NULL) as has_audience_analysis
FROM skyscraper_analyses 
WHERE video_id = 'some_video_id';
```

### 2. Supabase Client (for Frontend)

In frontend components, use the Supabase client to access data:

```typescript
// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Query example
const { data, error } = await supabase
  .from('skyscraper_analyses')
  .select('*')
  .eq('video_id', videoId)
  .order('created_at', { ascending: false })
  .limit(1);
```

### 3. API Routes (for Backend)

Server-side API routes can use the Supabase admin client:

```typescript
// In API route
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Example: Save analysis
const { data, error } = await supabaseAdmin
  .from('skyscraper_analyses')
  .insert({
    video_id: videoId,
    user_id: userId,
    model_used: modelId,
    content_analysis: analysisResults.content_analysis,
    audience_analysis: analysisResults.audience_analysis,
    // ...other fields
  });
```

## Skyscraper Analyses Structure

The `skyscraper_analyses` table contains the following fields:

| Field Name | Type | Description |
|------------|------|-------------|
| `id` | UUID | Primary key |
| `video_id` | TEXT | YouTube video ID |
| `content_analysis` | JSONB | Content structure, key points, etc. |
| `audience_analysis` | JSONB | Sentiment, demographic signals, etc. |
| `content_gaps` | JSONB | Missing information, follow-up opportunities |
| `structure_elements` | JSONB | Structure, pacing, information hierarchy |
| `engagement_techniques` | JSONB | Hook strategies, retention mechanisms |
| `value_delivery` | JSONB | Information packaging, trust building |
| `implementation_blueprint` | JSONB | Templates, key sections, CTA strategy |
| `model_used` | TEXT | AI model used (e.g., claude-3-7-sonnet-20240620) |
| `tokens_used` | INTEGER | Number of tokens consumed |
| `cost` | DOUBLE PRECISION | Cost of the analysis |
| `status` | TEXT | Current status (e.g., 'completed') |
| `progress` | INTEGER | Progress percentage |
| `started_at` | TIMESTAMPTZ | When the analysis started |
| `completed_at` | TIMESTAMPTZ | When the analysis completed |
| `user_id` | UUID | User who requested the analysis |
| `created_at` | TIMESTAMPTZ | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | Record update timestamp |

## JSON Structure

Each JSONB field follows a specific structure according to the Skyscraper framework:

### content_analysis

```json
{
  "structural_organization": [
    {"title": "Section Name", "start_time": "MM:SS", "end_time": "MM:SS", "description": "Brief description"}
  ],
  "key_points": [
    {"point": "Main point", "timestamp": "MM:SS", "elaboration": "Details about this point"}
  ],
  "technical_information": [
    {"topic": "Technical topic", "details": "Specific technical details mentioned"}
  ],
  "expertise_elements": "Analysis of how expertise is demonstrated",
  "visual_elements": [
    {"element": "Visual element", "purpose": "How it supports the content"}
  ]
}
```

### audience_analysis

```json
{
  "sentiment_overview": {
    "general_sentiment": "Overall sentiment (positive/negative/mixed)",
    "key_themes": ["Theme 1", "Theme 2"]
  },
  "praise_points": ["Point 1", "Point 2"],
  "questions_gaps": ["Question 1", "Question 2"],
  "use_cases": ["Use case 1", "Use case 2"],
  "demographic_signals": "Information about target audience",
  "engagement_patterns": "How viewers engage with the content"
}
```

For complete JSON schema details, see [skyscraper-schema-simple-README.md](./skyscraper-schema-simple-README.md).

## Best Practices

1. **Always validate data** before saving to the database
2. **Use helper functions** to extract specific components from complex JSON
3. **Include error handling** for all database operations
4. **Limit query results** when retrieving large datasets
5. **Use transactions** for related operations
6. **Add indexes** for frequently queried fields

## Troubleshooting

Common issues and their solutions:

1. **Empty analysis fields**: Check if JSON parsing was successful before saving
2. **Missing data**: Verify all required fields are included in insert/update operations
3. **Format errors**: Ensure JSON structure matches the expected schema
4. **Performance issues**: Add indexes and optimize queries for large datasets

## MCP Query Guidelines for AI Assistants

When using MCP to query the database:

1. **Start with schema inspection** to understand available tables and fields
2. **Use COUNT queries** before retrieving large datasets
3. **Include LIMIT** in queries to prevent overwhelming responses
4. **Format complex JSON results** for readability
5. **Check for NULL values** when analyzing data
6. **Focus on relevant fields** rather than selecting all columns

For any questions or issues with database access, consult the development team. 