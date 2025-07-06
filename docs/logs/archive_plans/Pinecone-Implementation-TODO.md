# Pinecone Semantic Search Implementation TODO

## Phase 1: Infrastructure Setup & Database Integration

### 1.1 Pinecone Account & Environment Setup
- [x] Create Pinecone account and get API key
- [x] Set up production index: `youtube-titles-prod`
- [ ] Set up development index: `youtube-titles-dev`
- [x] Configure environment variables in `.env`
  - [x] `PINECONE_API_KEY`
  - [x] `PINECONE_INDEX_NAME`
  - [x] `PINECONE_ENVIRONMENT`

### 1.2 Package Installation
- [x] Install Pinecone SDK: `npm install @pinecone-database/pinecone`
- [x] Update package.json dependencies
- [x] Verify OpenAI SDK is available for embeddings

### 1.3 Supabase Schema Updates
- [x] Add embedding tracking columns to videos table:
  ```sql
  ALTER TABLE videos ADD COLUMN pinecone_embedded BOOLEAN DEFAULT FALSE;
  ALTER TABLE videos ADD COLUMN pinecone_embedding_version VARCHAR(10) DEFAULT 'v1';
  ALTER TABLE videos ADD COLUMN pinecone_last_updated TIMESTAMP;
  ```
- [x] Create index for efficient embedding queries:
  ```sql
  CREATE INDEX idx_videos_pinecone_embedded ON videos(pinecone_embedded);
  ```
- [x] Test schema changes with sample data

## Phase 2: Core Services Implementation

### 2.1 Pinecone Service Class
- [x] Create `/lib/pinecone-service.ts`
- [x] Implement PineconeService class with methods:
  - [x] `initializeIndex()` - Initialize Pinecone connection
  - [x] `upsertEmbeddings()` - Bulk upload embeddings
  - [x] `searchSimilar()` - Semantic search query
  - [x] `deleteEmbeddings()` - Cleanup operations
  - [x] `getIndexStats()` - Monitor index health

### 2.2 Title Embedding Service
- [x] Create `/lib/title-embeddings.ts`
- [x] Implement functions:
  - [x] `generateTitleEmbedding()` - Single title embedding
  - [x] `batchGenerateTitleEmbeddings()` - Batch processing with rate limiting
  - [x] `syncVideoToPinecone()` - Sync individual video data
  - [x] `batchSyncVideosToPinecone()` - Batch sync operations
  - [x] `generateQueryEmbedding()` - Query embedding for search

### 2.3 Supabase-Pinecone Data Linking
- [x] Create `/lib/supabase-pinecone-sync.ts`
- [x] Implement linking functions:
  - [x] `getUnsyncedVideos()` - Get videos not yet in Pinecone
  - [x] `getVideoMetadataForPinecone()` - Fetch video data for embedding
  - [x] `updateVideoEmbeddingStatus()` - Mark videos as synced
  - [x] `getSyncStats()` - Comprehensive sync statistics
  - [x] `validateSyncConsistency()` - Sync validation checks
  - [x] `getVideosWithTitleChanges()` - Check for videos needing re-embedding
  - [x] `resetEmbeddingStatus()` - Reset sync status for videos

## Phase 3: API Endpoints

### 3.1 Embedding Generation API
- [x] Create `/app/api/embeddings/titles/batch/route.ts`
- [x] Implement endpoints:
  - [x] `POST /api/embeddings/titles/batch` - Batch embedding generation
  - [x] `GET /api/embeddings/titles/batch` - Check embedding status & stats
  - [x] Support for specific video_ids or unsynced videos
- [x] Add proper error handling and rate limiting
- [x] Implement progress tracking for batch operations

### 3.2 Semantic Search API
- [x] Create `/app/api/search/semantic/route.ts`
- [x] Implement search endpoint:
  - [x] `GET /api/search/semantic` - Main search endpoint
  - [x] `POST /api/search/semantic` - Advanced search with filters
  - [x] Query parameter handling (query, limit, min_score)
  - [x] Pinecone similarity search integration
  - [x] Supabase metadata enrichment (performance scores, view counts)
  - [x] Response formatting with similarity scores

### 3.3 Management API
- [x] Create `/app/api/embeddings/manage/route.ts`
- [x] Implement management endpoints:
  - [x] `GET /api/embeddings/manage?operation=stats` - Index statistics
  - [x] `GET /api/embeddings/manage?operation=health` - Health check
  - [x] `POST /api/embeddings/manage` - Multiple operations (sync, cleanup, validate, reset, delete)

## Phase 4: Frontend Implementation

### 4.1 Search Component
- [ ] Create `/components/search/semantic-search.tsx`
- [ ] Implement search features:
  - [ ] Search input with debounced queries (300ms)
  - [ ] Loading states and skeleton UI
  - [ ] Error handling and retry logic
  - [ ] Search suggestions/autocomplete

### 4.2 Results Display
- [ ] Create `/components/search/search-results.tsx`
- [ ] Implement results features:
  - [ ] Video cards with similarity scores
  - [ ] Performance badges (separate from similarity)
  - [ ] Infinite scroll pagination
  - [ ] Sort options (similarity, performance, views, date)

### 4.3 Search Page
- [ ] Create `/app/search/page.tsx`
- [ ] Implement search page:
  - [ ] Layout with search input and results
  - [ ] URL parameter handling for shareable searches
  - [ ] Search analytics tracking
  - [ ] Mobile-responsive design

### 4.4 React Hooks
- [ ] Create `/hooks/use-semantic-search.ts`
- [ ] Implement search hook:
  - [ ] Search state management
  - [ ] Debounced search queries
  - [ ] Result caching
  - [ ] Loading and error states

## Phase 5: Data Migration & Sync

### 5.1 Initial Data Migration
- [ ] Create migration script `/scripts/migrate-titles-to-pinecone.js`
- [ ] Implement migration process:
  - [ ] Fetch all existing videos from Supabase
  - [ ] Batch process titles (1000 at a time)
  - [ ] Generate embeddings via OpenAI API
  - [ ] Upload to Pinecone with metadata
  - [ ] Update Supabase embedding status

### 5.2 Ongoing Sync Process
- [ ] Create sync service `/lib/embedding-sync-service.ts`
- [ ] Implement sync functions:
  - [ ] `syncNewVideos()` - Embed new videos automatically
  - [ ] `syncUpdatedVideos()` - Re-embed videos with title changes
  - [ ] `cleanupOrphanedEmbeddings()` - Remove deleted videos
  - [ ] `validateSync()` - Check Supabase-Pinecone consistency

### 5.3 Automation & Monitoring
- [ ] Create cron job for regular sync: `/app/api/cron/sync-embeddings/route.ts`
- [ ] Implement monitoring:
  - [ ] Sync success/failure tracking
  - [ ] API quota monitoring (OpenAI/Pinecone)
  - [ ] Performance metrics collection
  - [ ] Error alerting system

## Phase 6: Testing & Optimization

### 6.1 Unit Tests
- [ ] Test Pinecone service functions
- [ ] Test embedding generation
- [ ] Test search API endpoints
- [ ] Test React components

### 6.2 Integration Tests
- [ ] Test end-to-end search flow
- [ ] Test data sync processes
- [ ] Test error handling scenarios
- [ ] Test performance under load

### 6.3 Performance Optimization
- [ ] Implement search result caching
- [ ] Optimize batch embedding processes
- [ ] Add database query optimization
- [ ] Implement lazy loading for video metadata

## Phase 7: Production Deployment

### 7.1 Environment Setup
- [ ] Configure production Pinecone index
- [ ] Set up environment variables in production
- [ ] Configure monitoring and alerting
- [ ] Set up backup processes

### 7.2 Launch Preparation
- [ ] Load test search functionality
- [ ] Verify all ~8,000 videos are embedded
- [ ] Test search relevance and performance
- [ ] Prepare rollback plan

### 7.3 Post-Launch Monitoring
- [ ] Monitor search performance metrics
- [ ] Track user engagement with semantic search
- [ ] Monitor API costs (OpenAI/Pinecone)
- [ ] Collect user feedback for improvements

## Key Data Flow & Linking Strategy

### Supabase → Pinecone Sync Process
1. **Video Data Source**: Supabase `videos` table contains all video metadata
2. **Embedding Generation**: OpenAI API creates embeddings from video titles
3. **Pinecone Storage**: Embeddings stored with video_id as key + metadata
4. **Sync Tracking**: Supabase tracks which videos are embedded in Pinecone
5. **Search Flow**: Query → Pinecone similarity → Supabase metadata enrichment

### Critical Linking Points
- **Primary Key**: `video_id` links Supabase videos to Pinecone vectors
- **Metadata Sync**: Essential video data (title, channel, performance) stored in both systems
- **Consistency Checks**: Regular validation that Supabase and Pinecone are in sync
- **Update Handling**: When video metadata changes, both systems must be updated

## Success Criteria
- [ ] All existing videos (~8,000) embedded in Pinecone
- [ ] Search response times under 500ms
- [ ] High semantic relevance in search results
- [ ] Smooth user experience with intuitive interface
- [ ] Reliable sync between Supabase and Pinecone
- [ ] Cost-effective operation within API limits

## Estimated Timeline: 5 weeks
- **Week 1**: Phase 1-2 (Infrastructure + Core Services)
- **Week 2**: Phase 3 (API Endpoints)
- **Week 3**: Phase 4 (Frontend Implementation)
- **Week 4**: Phase 5 (Data Migration)
- **Week 5**: Phase 6-7 (Testing + Deployment)