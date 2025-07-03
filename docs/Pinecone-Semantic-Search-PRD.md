# YouTube Intelligence Dashboard: Semantic Title Search PRD

## 1. Overview & Objectives

### Problem Statement
The YouTube Intelligence Dashboard currently has 8,000+ videos and needs semantic search capabilities to help users find high-performing titles based on conceptual similarity rather than keyword matching. The system will scale to 100,000+ videos, requiring a dedicated vector database solution.

### Core Objectives
- Enable semantic search across video titles using natural language queries
- Provide fast, scalable similarity search for 100,000+ videos
- Maintain separation from existing pgvector implementation
- Create foundation for future channel-level and visual embeddings

### Success Metrics
- Sub-500ms search response times at 100k+ scale
- High semantic relevance in search results
- Smooth user experience with intuitive search interface

## 2. Technical Architecture

### 2.1 Pinecone Integration
```
Database Stack:
├── Existing: Supabase (video metadata, performance scores)
├── New: Pinecone (title embeddings, semantic search)
└── OpenAI API (embedding generation)
```

### 2.2 Data Flow
```
Video Title → OpenAI Embedding → Pinecone Index → Search Results → UI
     ↓              ↓               ↓               ↓          ↓
   videos table → pinecone-api → similarity API → React Hook → Search Component
```

### 2.3 Core Components
- **Pinecone Service** (`/lib/pinecone-service.ts`) - Vector operations
- **Title Embedding API** (`/api/embeddings/titles/`) - Embedding generation
- **Semantic Search API** (`/api/search/semantic/`) - Search endpoint
- **Search UI** (`/components/search/semantic-search.tsx`) - New interface

## 3. Implementation Phases

### Phase 1: Infrastructure Setup (Week 1-2)
- [ ] Pinecone account setup and index creation
- [ ] Install Pinecone SDK and environment configuration
- [ ] Create `PineconeService` class for vector operations
- [ ] Implement title embedding pipeline using OpenAI API

### Phase 2: Data Migration (Week 2-3)
- [ ] Batch process existing ~8,000 video titles
- [ ] Create embeddings and upload to Pinecone
- [ ] Implement incremental embedding for new videos
- [ ] Add embedding status tracking to videos table

### Phase 3: Search API (Week 3-4)
- [ ] Build semantic search API endpoint
- [ ] Implement query embedding and similarity search
- [ ] Integrate with existing video metadata from Supabase
- [ ] Add performance optimizations and caching

### Phase 4: UI Implementation (Week 4-5)
- [ ] Create new semantic search interface
- [ ] Implement search results display with similarity scores
- [ ] Add loading states and error handling
- [ ] Integrate with existing video performance data

## 4. API Design

### 4.1 Embedding Generation
```typescript
POST /api/embeddings/titles/batch
{
  "video_ids": ["video_id_1", "video_id_2", ...],
  "force_refresh": false
}

Response:
{
  "processed": 150,
  "skipped": 10,
  "errors": 0,
  "batch_id": "batch_123"
}
```

### 4.2 Semantic Search
```typescript
GET /api/search/semantic?query=ways+to+save+money+on+lasers&limit=20

Response:
{
  "results": [
    {
      "video_id": "abc123",
      "title": "5 Ways to Cut Laser Costs in Half",
      "similarity_score": 0.89,
      "performance_ratio": 2.3,
      "view_count": 45000,
      "channel_name": "Tech Reviews",
      "thumbnail_url": "https://i.ytimg.com/vi/abc123/hqdefault.jpg"
    }
  ],
  "total_results": 156,
  "query_time_ms": 45
}
```

## 5. UI/UX Requirements

### 5.1 Search Interface
- **Clean search input** with placeholder "Search for video concepts..."
- **Real-time search** with debounced queries (300ms delay)
- **Search suggestions** showing similar past queries
- **Results display** showing similarity scores alongside performance metrics

### 5.2 Results Display
- **Video cards** similar to existing PackagingCard component
- **Similarity indicator** (0-100% semantic match)
- **Performance badge** (separate from similarity)
- **Infinite scroll** for large result sets
- **Sort options**: Similarity, Performance, Views, Date

### 5.3 Search States
- **Loading state** with skeleton cards
- **Empty state** with suggestions for better queries
- **Error state** with retry functionality
- **No results** with query refinement suggestions

## 6. Data Schema

### 6.1 Pinecone Index Structure
```typescript
Index Name: "youtube-titles-prod"
Dimensions: 1536 (OpenAI text-embedding-3-small)
Metric: cosine

Vector Metadata:
{
  "video_id": "abc123",
  "title": "5 Ways to Cut Laser Costs in Half",
  "channel_id": "channel_456",
  "view_count": 45000,
  "published_at": "2024-01-15T10:00:00Z",
  "performance_ratio": 2.3,
  "embedding_version": "v1"
}
```

### 6.2 Supabase Schema Updates
```sql
-- Add embedding tracking to videos table
ALTER TABLE videos ADD COLUMN pinecone_embedded BOOLEAN DEFAULT FALSE;
ALTER TABLE videos ADD COLUMN pinecone_embedding_version VARCHAR(10) DEFAULT 'v1';
ALTER TABLE videos ADD COLUMN pinecone_last_updated TIMESTAMP;

-- Index for efficient embedding queries
CREATE INDEX idx_videos_pinecone_embedded ON videos(pinecone_embedded);
```

## 7. Performance Requirements

### 7.1 Scalability Targets
- **100,000+ videos** in Pinecone index
- **Sub-500ms response times** for semantic search
- **Concurrent users**: 50+ simultaneous searches
- **Embedding throughput**: 1,000 titles/minute during batch processing

### 7.2 Optimization Strategies
- **Batch embedding processing** with OpenAI API rate limits
- **Caching layer** for popular search queries
- **Pagination** for large result sets
- **Lazy loading** for video metadata

## 8. Environment Configuration

### 8.1 Required Environment Variables
```bash
# Pinecone Configuration
PINECONE_API_KEY=your-api-key
PINECONE_INDEX_NAME=youtube-titles-prod
PINECONE_ENVIRONMENT=us-west1-gcp

# OpenAI (existing)
OPENAI_API_KEY=your-existing-key
```

### 8.2 Development vs Production
- **Development**: Separate Pinecone index with subset of data
- **Production**: Full dataset with performance monitoring
- **Staging**: Mirror of production for testing

## 9. Future Considerations

### 9.1 Channel-Level Embeddings (Phase 2)
- **Channel embeddings** from aggregated top-performing titles
- **Channel similarity clustering** for recommendation enhancement
- **Cross-channel influence scoring**

### 9.2 Visual Thumbnail Embeddings (Phase 3)
- **CLIP model integration** for thumbnail embeddings
- **Multimodal search** combining text and visual similarity
- **Thumbnail performance analysis** based on visual elements

### 9.3 Advanced Features
- **Semantic clustering** of high-performing title patterns
- **Trend analysis** using embedding similarity over time
- **Personalized recommendations** based on user's channel content

## 10. Risk Mitigation

### 10.1 Technical Risks
- **Pinecone API limits**: Implement proper rate limiting and retry logic
- **OpenAI API costs**: Monitor usage and implement cost controls
- **Index corruption**: Regular backups and monitoring

### 10.2 User Experience Risks
- **Search relevance**: A/B testing and user feedback loops
- **Performance degradation**: Monitoring and alerting systems
- **Integration complexity**: Thorough testing of new vs existing features

---

**Estimated Timeline**: 5 weeks
**Resources Required**: 1 developer, Pinecone subscription, OpenAI API credits
**Success Criteria**: Fast semantic search with high relevance for 100k+ videos