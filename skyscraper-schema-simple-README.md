# Simplified Skyscraper Analysis Framework

This document explains the simplified Skyscraper Analysis Framework database schema and how to use it in your application.

## Overview

The simplified schema consolidates all analysis data into a single `skyscraper_analyses` table with JSONB fields for each component of the analysis. This approach offers several advantages:

1. **Simplified Data Model**: All analysis data is stored in one table instead of multiple related tables
2. **Flexible Schema**: JSONB fields can accommodate changes to the analysis structure without requiring schema modifications
3. **Easier Queries**: No need for complex joins to retrieve complete analysis data
4. **Better Performance**: Single-table queries are typically faster than multi-table joins

## Database Schema

The `skyscraper_analyses` table has the following structure:

```sql
CREATE TABLE IF NOT EXISTS public.skyscraper_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id TEXT NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model_used TEXT NOT NULL,
  content_analysis JSONB,
  audience_analysis JSONB,
  content_gaps JSONB,
  framework_elements JSONB,
  engagement_techniques JSONB,
  value_delivery JSONB,
  implementation_blueprint JSONB,
  raw_analysis TEXT,
  analysis_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## JSONB Structure

Each JSONB field follows a specific structure:

1. **content_analysis**:
   - `structural_organization`: Array of sections with timestamps
   - `key_points`: Array of main arguments/insights
   - `technical_information`: Specific data/specs mentioned
   - `expertise_elements`: How expertise is demonstrated
   - `visual_elements`: Visual components and their purpose

2. **audience_analysis**:
   - `sentiment_overview`: Sentiment distribution and key themes
   - `praise_points`: What viewers praised
   - `questions_gaps`: Common questions and concerns
   - `use_cases`: How viewers use the information
   - `demographic_signals`: Audience characteristics
   - `engagement_patterns`: How viewers engage with content

3. **content_gaps**:
   - `missing_information`: Topics not covered
   - `follow_up_opportunities`: Potential follow-up content
   - `clarity_issues`: Areas of confusion
   - `depth_breadth_balance`: Assessment of content depth vs breadth

4. **framework_elements**:
   - `overall_structure`: Structural approach
   - `section_ratios`: Time allocation across sections
   - `information_hierarchy`: Information prioritization
   - `pacing_flow`: Content pacing and transitions

5. **engagement_techniques**:
   - `hook_strategy`: How the video hooks viewers
   - `retention_mechanisms`: Techniques to maintain attention
   - `pattern_interrupts`: Changes in delivery to maintain interest
   - `interaction_prompts`: Ways to encourage viewer interaction

6. **value_delivery**:
   - `information_packaging`: How information is structured
   - `problem_solution_framing`: Problem-solution presentation
   - `practical_application`: How to apply the information
   - `trust_building`: Methods to build credibility

7. **implementation_blueprint**:
   - `content_template`: Template for similar content
   - `key_sections`: Recommended sections
   - `engagement_points`: Opportunities for engagement
   - `differentiation_opportunities`: Ways to stand out
   - `cta_strategy`: Call-to-action approach

## Setup Instructions

1. **Create the Database Schema**:
   ```bash
   node setup-skyscraper-schema-simple.js
   ```

2. **Update API Endpoint**:
   The `app/api/skyscraper/analyze-single/route.ts` file has been updated to:
   - Generate structured output from Claude that matches the JSONB schema
   - Store the analysis results in the `skyscraper_analyses` table

3. **Query Examples**:
   See `sql/skyscraper-queries.sql` for sample queries to retrieve and update analysis data

## API Usage

The updated API endpoint returns:

```json
{
  "success": true,
  "videoId": "video_id",
  "modelUsed": "Claude 3.7 Sonnet",
  "analysisResults": { ... },
  "analysisId": "uuid",
  "systemPrompt": "...",
  "userPrompt": "..."
}
```

## Frontend Integration

To display analysis data from the new table structure:

1. Fetch the most recent analysis for a video:
   ```typescript
   const { data, error } = await supabase
     .from('skyscraper_analyses')
     .select('*')
     .eq('video_id', videoId)
     .order('analysis_date', { ascending: false })
     .limit(1)
     .single();
   ```

2. Access specific components:
   ```typescript
   const contentAnalysis = data.content_analysis;
   const audienceAnalysis = data.audience_analysis;
   // etc.
   ```

3. Render the components in your UI as needed

## Benefits of the Simplified Schema

- **Easier Maintenance**: One table to manage instead of multiple related tables
- **Simplified Queries**: No complex joins required
- **Flexible Structure**: Can easily add or modify fields without schema changes
- **Better Performance**: Single-table queries are typically faster
- **Simpler API**: Cleaner code for storing and retrieving analysis data 