# LLM Summary System Documentation

## Overview

The LLM Summary System generates concise, content-focused summaries of YouTube videos from their descriptions. These summaries improve BERTopic clustering by extracting semantic meaning while removing promotional content.

## System Architecture

### 1. Database Schema

```sql
-- New columns in videos table
llm_summary TEXT                      -- The generated summary
llm_summary_generated_at TIMESTAMP    -- When generated
llm_summary_model VARCHAR(50)         -- Model used (e.g., gpt-4o-mini)
llm_summary_embedding_synced BOOLEAN  -- Whether synced to Pinecone

-- Status view
llm_summary_status                    -- Tracks generation progress
```

### 2. Pinecone Configuration

```yaml
Index Name: video-summaries (or use namespace in existing index)
Dimension: 512 (text-embedding-3-small)
Metric: cosine
Namespace: llm-summaries
```

### 3. Cost Analysis

- **Model**: GPT-4o-mini
- **Cost**: $0.15/1M input tokens, $0.60/1M output tokens
- **Per video**: ~200 tokens = $0.00006
- **178K videos**: ~$10.68 standard, **$5.34 with Batch API**
- **Processing time**: 24 hours for batch API

## Implementation Components

### Core Services

1. **`lib/llm-summary-batch-processor.ts`**
   - Handles OpenAI Batch API for bulk processing
   - 50% cost savings vs standard API
   - Processes up to 50,000 videos per batch

2. **`lib/pinecone-summary-service.ts`**
   - Manages summary embeddings in Pinecone
   - Handles search by semantic similarity
   - Syncs embeddings from database

3. **`lib/unified-import-summary-integration.ts`**
   - Integrates with unified video import
   - Runs in parallel with other processing
   - Real-time summary generation

### Scripts & Workers

1. **Batch Processing** (`scripts/generate-llm-summaries.js`)
   ```bash
   # Prepare batch files
   node scripts/generate-llm-summaries.js prepare 10000
   
   # Check status
   node scripts/generate-llm-summaries.js status batch_xxxxx
   
   # Process results
   node scripts/generate-llm-summaries.js process batch_xxxxx
   ```

2. **Continuous Worker** (`npm run worker:llm-summary`)
   - Processes videos without summaries
   - Runs alongside other workers
   - Prioritizes popular videos

3. **Embedding Sync** (`scripts/sync-summary-embeddings.js`)
   ```bash
   # Sync 100 embeddings
   node scripts/sync-summary-embeddings.js 100
   ```

## Usage Workflows

### 1. Initial Bulk Processing

```bash
# Step 1: Apply database schema
psql $DATABASE_URL < sql/add-llm-summary-columns.sql

# Step 2: Generate summaries for all videos
node scripts/generate-llm-summaries.js prepare

# Step 3: Wait 24 hours, then process results
node scripts/generate-llm-summaries.js process batch_xxxxx

# Step 4: Sync embeddings to Pinecone
node scripts/sync-summary-embeddings.js
```

### 2. Ongoing Processing

```bash
# Run the worker for continuous processing
npm run worker:llm-summary

# Or add to workers:all for concurrent processing
```

### 3. Integration with Unified Import

The system automatically generates summaries during video import:

```javascript
// In API calls
const response = await fetch('/api/video-import/unified', {
  method: 'POST',
  body: JSON.stringify({
    source: 'competitor',
    channelIds: ['UC...'],
    options: {
      skipSummaries: false,  // Enable summary generation
      summaryModel: 'gpt-4o-mini'
    }
  })
});
```

## Prompt Engineering

The system uses an "Action-First" prompt that performed best in testing:

```
Analyze this YouTube description and extract only the core content, 
ignoring all promotional material.

Describe what happens or what is taught in 1-2 sentences. Start with 
an action verb or noun phrase. Never mention "video", "tutorial", or 
similar meta-references.

Focus purely on the content itself - the techniques, materials, 
concepts, and outcomes.
```

This prompt:
- Eliminates repetitive patterns ("The video...")
- Focuses on semantic content
- Removes promotional noise
- Produces consistent, searchable summaries

## Search Capabilities

Once summaries are generated and embedded:

```javascript
import { PineconeSummaryService } from './lib/pinecone-summary-service';

const service = new PineconeSummaryService();
const results = await service.searchBySummary(
  "building custom furniture with hand tools",
  10 // top K results
);
```

## Monitoring & Maintenance

### Check Progress

```sql
-- View summary generation status
SELECT * FROM llm_summary_status;

-- Find videos needing summaries
SELECT COUNT(*) FROM videos 
WHERE llm_summary IS NULL 
  AND description IS NOT NULL 
  AND LENGTH(description) >= 50;

-- Check embedding sync status
SELECT COUNT(*) FROM videos 
WHERE llm_summary IS NOT NULL 
  AND NOT llm_summary_embedding_synced;
```

### Cost Tracking

The system logs token usage and costs. Monitor actual costs vs estimates:

```javascript
// In worker output
📊 Total processed: 1000 | Errors: 5
💰 Estimated cost: $0.06
```

## Best Practices

1. **Use Batch API for bulk processing** - 50% cost savings
2. **Process popular videos first** - Better ROI on summaries
3. **Run embedding sync after batches** - Avoid rate limits
4. **Monitor error rates** - Retry failed summaries
5. **Test search quality** - Ensure summaries improve results

## Troubleshooting

### Common Issues

1. **Rate Limiting**
   - Reduce batch size in worker
   - Add longer delays between batches

2. **Empty Summaries**
   - Check description quality
   - Adjust minimum description length

3. **Embedding Sync Failures**
   - Verify Pinecone index exists
   - Check API keys and quotas

4. **High Costs**
   - Use Batch API for bulk work
   - Consider sampling strategy
   - Monitor token usage

## Future Enhancements

1. **Multi-language support** - Detect and handle non-English content
2. **Summary quality scoring** - Identify low-quality summaries
3. **Incremental updates** - Update summaries when descriptions change
4. **A/B testing** - Compare clustering quality with/without summaries
5. **Custom models** - Fine-tune smaller models for cost savings