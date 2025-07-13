# Unified Video Import with Integrated Classification

## Overview

The unified video import system now includes seamless classification of videos during the import process. When you import videos, they automatically get:

1. **Format Classification** - Using LLM to classify videos into formats like tutorial, listicle, explainer, etc.
2. **Topic Classification** - Using BERTopic clusters to assign domain/niche/micro-topic based on title embeddings

## How It Works

### Import Pipeline Flow

1. **Extract Metadata** - Fetch video details from YouTube API
2. **Store in Database** - Save video metadata to Supabase
3. **Generate Embeddings** - Create title (512D) and thumbnail (768D) embeddings
4. **Classify Videos** (NEW)
   - Format classification using GPT-4o-mini
   - Topic classification using BERTopic k-NN
5. **Export & Upload** - Save embeddings locally and upload to Pinecone

### Classification Details

#### Format Classification
- Uses `llmFormatClassificationService` 
- Processes videos in batches of 15 for optimal token usage
- Classifies into 12 format types:
  - tutorial, listicle, explainer, case_study
  - news_analysis, personal_story, product_focus
  - live_stream, shorts, vlog, compilation, update
- Stores: `format_type`, `format_confidence`, `format_primary`

#### Topic Classification
- Uses `topicDetectionService` with pre-computed BERTopic clusters
- Requires title embeddings to be generated first
- Assigns hierarchical topics:
  - Domain (e.g., "Science & Technology")
  - Niche (e.g., "Engineering")
  - Micro-topic (e.g., "Mechanical Engineering Concepts")
- Stores: `topic_domain`, `topic_niche`, `topic_micro`, `topic_cluster_id`, `topic_confidence`

## Usage

### Basic Import with Classification

```javascript
const request = {
  source: 'competitor',
  channelIds: ['UC6107grRI4m0o2-emgoDnAA'],
  options: {
    skipClassification: false,  // Enable classification
    maxVideosPerChannel: 50,
    batchSize: 50
  }
};

const result = await videoImportService.processVideos(request);
console.log(`Classified ${result.classificationsGenerated} videos`);
```

### API Endpoint

```bash
curl -X POST http://localhost:3000/api/video-import/unified \
  -H "Content-Type: application/json" \
  -d '{
    "source": "competitor",
    "channelIds": ["UC6107grRI4m0o2-emgoDnAA"],
    "options": {
      "skipClassification": false,
      "maxVideosPerChannel": 10
    }
  }'
```

### Control Options

- `skipClassification: true` - Skip classification entirely
- `skipEmbeddings: true` - Skip embeddings (also skips topic classification)
- `skipTitleEmbeddings: true` - Skip title embeddings (also skips topic classification)

## Performance Considerations

1. **LLM Costs** - Format classification uses GPT-4o-mini (~$0.15 per 1M tokens)
2. **Processing Time** - Adds ~5-10 seconds per 100 videos
3. **Batch Processing** - Classifications run in parallel with controlled concurrency
4. **Error Handling** - Classification failures don't stop the import

## Database Schema

Videos table gets updated with:
```sql
-- Format classification
format_type VARCHAR(50)
format_confidence FLOAT
format_primary VARCHAR(50)
classification_llm_used BOOLEAN
classification_timestamp TIMESTAMP

-- Topic classification  
topic_domain VARCHAR(255)
topic_niche VARCHAR(255)
topic_micro VARCHAR(255)
topic_cluster_id INTEGER
topic_confidence FLOAT
classified_at TIMESTAMP
```

## Monitoring

Check classification results:
```sql
-- Format distribution
SELECT format_type, COUNT(*) as count 
FROM videos 
WHERE format_type IS NOT NULL 
GROUP BY format_type 
ORDER BY count DESC;

-- Topic distribution
SELECT topic_domain, topic_niche, COUNT(*) as count
FROM videos
WHERE topic_domain IS NOT NULL
GROUP BY topic_domain, topic_niche
ORDER BY count DESC;

-- Low confidence classifications
SELECT id, title, format_confidence, topic_confidence
FROM videos
WHERE format_confidence < 0.7 OR topic_confidence < 0.7
ORDER BY format_confidence ASC;
```

## Troubleshooting

1. **Classifications not running**
   - Check `skipClassification` is false
   - Ensure embeddings are generated (required for topics)
   - Check console logs for errors

2. **Missing topic classifications**
   - Verify BERTopic clusters are loaded
   - Check that title embeddings were generated
   - Look for errors in topic assignment

3. **Format classification failures**
   - Check OpenAI API key is set
   - Monitor token usage and costs
   - Review fallback classifications

## Future Improvements

1. **Learning System** - Track LLM corrections to improve keyword-based detection
2. **Custom Models** - Fine-tune models for your specific content domain
3. **Bulk Reclassification** - API endpoints to reclassify existing videos
4. **Confidence Thresholds** - Configurable thresholds for manual review