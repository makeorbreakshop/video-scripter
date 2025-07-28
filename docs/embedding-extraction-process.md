# Embedding Extraction Process Documentation

## Overview
This document describes the process used to extract title embeddings from Pinecone for HDBSCAN clustering analysis.

## Background
- **Date**: July 25, 2025
- **Total Videos**: ~173,000 in database
- **Embeddings**: 512-dimensional OpenAI text-ada-002 vectors
- **Storage**: Pinecone vector database (index: `video-scripter`)

## Extraction Process

### Initial Attempts (Failed)
Multiple attempts to fetch all embeddings at once failed due to memory constraints:
- Fetching 173K embeddings × 512 dimensions = ~350MB of raw data
- JSON serialization caused "RangeError: Invalid string length"
- Node.js memory limitations prevented single-file saves

### Successful Approach
Created `scripts/clustering/fetch-embeddings-simple.js` with incremental saving:

```javascript
const SAVE_EVERY = 10000;  // Save every 10K embeddings

// Key logic: Save to disk every 10K embeddings
if (embeddings.length >= SAVE_EVERY) {
    const filename = `embeddings-part-${fileNumber}.json`;
    fs.writeFileSync(filename, JSON.stringify({
        part: fileNumber,
        count: embeddings.length,
        embeddings: embeddings
    }));
    embeddings = [];  // Clear memory
    fileNumber++;
}
```

### Results
Successfully extracted **170,860 embeddings** saved in 17 parts:

| File | Embeddings | Size |
|------|------------|------|
| embeddings-part-1.json | 10,000 | 71.4 MB |
| embeddings-part-2.json | 10,000 | 71.5 MB |
| ... | ... | ... |
| embeddings-part-17.json | 860 | 69.5 MB |

**Total**: ~1.2 GB of embedding data

## File Location
All embedding files are stored in:
```
/Users/brandoncullum/video-scripter/scripts/clustering/embeddings-part-*.json
```

## File Structure
Each JSON file contains:
```json
{
  "part": 1,              // Part number
  "count": 10000,         // Number of embeddings in this part
  "embeddings": [         // Array of embedding objects
    {
      "id": "video_id",
      "values": [0.123, -0.456, ...],  // 512-dimensional vector
      "metadata": {
        "title": "Video Title",
        "channel_title": "Channel Name",
        "published_at": "2025-01-01T00:00:00Z"
      }
    }
  ]
}
```

## Next Steps
1. Combine all 17 parts for HDBSCAN clustering
2. Run clustering with various parameter combinations
3. Compare results to existing 777 BERT topics
4. Implement incremental clustering for new videos

## Usage
To load all embeddings:
```javascript
const fs = require('fs');
const glob = require('glob');

// Load all parts
const files = glob.sync('scripts/clustering/embeddings-part-*.json');
let allEmbeddings = [];

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(file));
  allEmbeddings = allEmbeddings.concat(data.embeddings);
}

console.log(`Total embeddings loaded: ${allEmbeddings.length}`);
```

## Notes
- Memory-efficient approach crucial for large datasets
- Incremental saving prevents data loss during long-running extractions
- Each embedding includes metadata for cluster analysis context