# Semantic Naming Pipeline Implementation Summary

## Overview
Created a complete semantic naming pipeline for HDBSCAN clusters that analyzes YouTube video titles to generate meaningful cluster names and hierarchical taxonomies.

## Scripts Created

### 1. **extract-cluster-keywords.js**
- Extracts keywords using TF-IDF algorithm
- Identifies common n-grams (bigrams, trigrams)
- Detects content patterns (tutorials, reviews, etc.)
- Processes ~500 videos per cluster for robust keyword extraction
- Outputs: `cluster-keywords-level{N}-{date}.json`

### 2. **generate-cluster-names.js**
- Uses Claude 3.5 Sonnet to generate semantic names
- Creates descriptive names based on keywords and sample titles
- Classifies content format and target audience
- Generates search terms and subtopics
- Outputs: `cluster-names-level{N}-{date}.json`

### 3. **generate-cluster-hierarchy.js**
- Builds hierarchical taxonomy with 8-15 parent categories
- Uses Claude to intelligently assign clusters to categories
- Balances category sizes for even distribution
- Creates parent-child relationships with confidence scores
- Outputs: `cluster-hierarchy-level{N}-{date}.json`

### 4. **store-cluster-metadata.js**
- Stores all metadata in Supabase database
- Creates two tables: `cluster_metadata` and `cluster_parent_categories`
- Supports incremental updates and upserts
- Generates distribution statistics

### 5. **process-all-clusters.js**
- Batch processing script that runs entire pipeline
- Supports processing single or multiple hierarchy levels
- Provides progress tracking and error handling
- Estimated runtime: 15-30 minutes per level

### 6. **test-pipeline.js**
- Verifies cluster data exists in database
- Tests keyword extraction on small sample
- Provides diagnostics for troubleshooting

## Database Schema

### cluster_metadata
```sql
- cluster_id: INTEGER (BERTopic cluster ID)
- level: INTEGER (1, 2, or 3)
- name: VARCHAR(255) (Human-readable name)
- description: TEXT
- primary_format: VARCHAR(50)
- content_focus: VARCHAR(50)
- audience_level: VARCHAR(50)
- keywords: TEXT[]
- search_terms: TEXT[]
- subtopics: TEXT[]
- video_count: INTEGER
- total_views: BIGINT
- avg_views: INTEGER
- parent_category_id: VARCHAR(100)
- confidence: FLOAT
```

### cluster_parent_categories
```sql
- id: VARCHAR(100) (Unique identifier)
- level: INTEGER
- name: VARCHAR(255)
- description: TEXT
- content_types: TEXT[]
- cluster_count: INTEGER
- total_videos: INTEGER
```

## Key Features

1. **Keyword Extraction**
   - TF-IDF with stopword removal
   - N-gram analysis for phrase detection
   - Pattern matching for content types

2. **LLM Integration**
   - Claude 3.5 Sonnet for name generation
   - Claude 3 Haiku for batch assignments
   - Rate limiting and error handling
   - Structured JSON outputs

3. **Hierarchy Generation**
   - Multi-level taxonomy (3 levels)
   - Balanced parent categories
   - Confidence scoring for assignments
   - Supports 557+ micro-topic clusters

4. **Batch Processing**
   - Processes clusters with 10+ videos
   - Concurrent API calls with rate limiting
   - Progress tracking and resumability
   - Automatic export generation

## Usage Example

```bash
# Test the pipeline
cd scripts/clustering
node test-pipeline.js

# Process level 3 (micro-topics)
node process-all-clusters.js 3

# Process all levels
node process-all-clusters.js all

# View results
cat exports/cluster-hierarchy-report-level3-*.txt
```

## Required Environment Variables
- `ANTHROPIC_API_KEY` - For Claude API access
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service key

## Dependencies Added
- `natural` - Natural language processing (TF-IDF)
- `stopword` - Stopword removal for better keywords

## Next Steps
1. Run the pipeline on all cluster levels
2. Review generated names and hierarchies
3. Use metadata for video classification
4. Integrate with discovery and recommendation systems