# RSS Daily Channel Monitor Implementation TODO

## Project Overview
Implement a daily YouTube channel monitoring system using RSS feeds to discover new videos efficiently while minimizing YouTube API quota usage.

## Phase 1: Database Schema & Core Infrastructure
- [ ] **SIMPLIFIED: Reuse existing database schema**
  - [ ] Use existing `videos` table (already has all needed fields)
  - [ ] Use existing `channel_import_status` table for tracking
  - [ ] Use existing vectorization fields (pinecone_embedded, etc.)
  - [ ] No new tables needed - leverage existing infrastructure

- [ ] Create `rss_feed_log` table for monitoring (optional)
  - [ ] `id` (UUID, primary key)
  - [ ] `channel_id` (text, reference to channel)
  - [ ] `videos_found` (integer, total videos in feed)
  - [ ] `new_videos_imported` (integer, new videos added)
  - [ ] `checked_at` (timestamp)
  - [ ] `status` (text: success, error, no_updates)
  - [ ] `error_message` (text, optional)

- [ ] **Optional: Create database migration file** (only if adding rss_feed_log)
- [ ] **Verify existing schema supports RSS imports**
  - [ ] Check data_source field supports 'rss' value
  - [ ] Verify vectorization fields are present
  - [ ] Test channel_import_status table compatibility

## Phase 2: RSS Feed Processing Service
- [ ] Install XML parsing library (fast-xml-parser or xml2js)
- [ ] Create `lib/rss-channel-monitor.ts`
  - [ ] `parseYouTubeRSSFeed()` function
  - [ ] `extractVideoData()` function
  - [ ] `compareVideoTimestamps()` function
  - [ ] `logFeedCheck()` function

- [ ] Create RSS parsing utilities
  - [ ] Handle XML parsing errors gracefully
  - [ ] Extract video metadata (id, title, published date, etc.)
  - [ ] Convert YouTube date format to database format
  - [ ] Generate RSS URLs from channel IDs
  - [ ] Map RSS data to existing videos table schema

- [ ] Leverage existing competitor import system
  - [ ] Reuse existing database schema (videos table)
  - [ ] Reuse performance calculation logic
  - [ ] Reuse batch processing infrastructure
  - [ ] Set data_source = 'rss' instead of 'competitor'

## Phase 3: Daily Monitor Core Logic
- [ ] Create `checkChannelRSSFeeds()` main function
  - [ ] Query existing videos table for unique channel_ids (no subscriptions table needed)
  - [ ] Process channels in batches (prevent memory issues)
  - [ ] Fetch RSS feed for each channel
  - [ ] Parse XML and extract video data
  - [ ] Compare against latest video timestamp per channel
  - [ ] Filter out existing videos (check by video ID)
  - [ ] Import new videos using adapted import-competitor logic

- [ ] Implement error handling
  - [ ] Handle network timeouts
  - [ ] Handle invalid RSS feeds
  - [ ] Handle deleted/private channels
  - [ ] Log errors for debugging
  - [ ] Continue processing other channels if one fails

- [ ] Add progress tracking
  - [ ] Track channels processed
  - [ ] Track new videos found
  - [ ] Track import success/failure rates
  - [ ] Provide real-time progress updates

- [ ] **CRITICAL: Include vectorization in import process**
  - [ ] Automatically trigger title embedding generation
  - [ ] Use existing `/api/embeddings/titles/batch` endpoint
  - [ ] Set pinecone_embedded = true after successful vectorization
  - [ ] Handle vectorization failures gracefully

## Phase 4: API Routes
- [ ] Create `/api/youtube/daily-monitor/route.ts`
  - [ ] POST endpoint to trigger daily check
  - [ ] Return summary of results
  - [ ] Handle authentication/authorization
  - [ ] **Adapt existing import-competitor logic for RSS feeds**
  - [ ] **Include automatic vectorization trigger**

- [ ] Create `/api/youtube/import-rss/route.ts` (new endpoint)
  - [ ] Reuse 90% of import-competitor API logic
  - [ ] Replace YouTube API calls with RSS parsing
  - [ ] Set data_source = 'rss' instead of 'competitor'
  - [ ] Trigger vectorization automatically after import

- [ ] Create `/api/youtube/monitor-status/route.ts`
  - [ ] GET: Recent monitoring logs
  - [ ] GET: Channel-specific stats
  - [ ] GET: Overall system health

- [ ] **No channel subscription management needed** - use existing videos table

## Phase 5: Tools Tab Integration
- [ ] Add Daily Channel Monitor section to `tools-tab.tsx`
  - [ ] "Check for New Videos" button
  - [ ] Progress indicator during processing
  - [ ] Results display (channels checked, videos found, errors)
  - [ ] Last run timestamp display

- [ ] Add Channel Subscription Management
  - [ ] List currently subscribed channels
  - [ ] Add new channel subscription form
  - [ ] Remove channel subscription option
  - [ ] Enable/disable channel monitoring

- [ ] Add Monitoring Dashboard
  - [ ] Recent monitoring activity log
  - [ ] Channel-specific statistics
  - [ ] Error rate monitoring
  - [ ] Performance metrics (time per channel, etc.)

## Phase 6: Enhanced Features
- [ ] Auto-discover channels from existing videos
  - [ ] Scan `videos` table for unique channel IDs
  - [ ] Automatically create subscriptions for existing channels
  - [ ] Validate channel IDs and RSS feeds

- [ ] Intelligent scheduling
  - [ ] Track optimal check frequency per channel
  - [ ] Skip inactive channels (no uploads in 30+ days)
  - [ ] Prioritize high-activity channels

- [ ] Batch processing optimizations
  - [ ] Process channels in parallel (with rate limiting)
  - [ ] Implement exponential backoff for failed feeds
  - [ ] Cache RSS feeds temporarily to avoid re-fetching

## Phase 7: Testing & Validation
- [ ] Unit tests for RSS parsing functions
- [ ] Integration tests for database operations
- [ ] End-to-end tests for daily monitor workflow
- [ ] Test error scenarios (invalid feeds, network issues)

- [ ] Performance testing
  - [ ] Test with 50+ channels
  - [ ] Measure processing time per channel
  - [ ] Monitor memory usage during batch processing

- [ ] Data validation
  - [ ] Verify no duplicate videos imported
  - [ ] Confirm all video metadata correctly extracted
  - [ ] Test with various channel types (active, inactive, deleted)

## Phase 8: Documentation & Maintenance
- [ ] Document RSS feed monitoring process
- [ ] Create troubleshooting guide
- [ ] Document database schema changes
- [ ] Add monitoring alerts for failed checks

- [ ] Setup automated monitoring
  - [ ] Daily health checks
  - [ ] Alert on consecutive failures
  - [ ] Monitor RSS feed availability

## Phase 9: Future Enhancements
- [ ] Implement PubSubHubbub for real-time notifications
- [ ] Add webhook infrastructure for instant updates
- [ ] Create scheduled cron job for automated daily runs
- [ ] Add email/Slack notifications for new videos
- [ ] Implement channel categorization and filtering

## Technical Decisions Made
- **RSS Polling**: Using simple RSS polling instead of PubSubHubbub for daily batch processing
- **Existing Integration**: Leveraging current `sync-channel` API for video importing
- **Database Schema**: Separate subscription tracking and logging tables
- **Error Handling**: Graceful degradation - continue processing other channels if one fails
- **UI Integration**: Adding to existing tools tab rather than separate page

## Success Metrics
- [ ] 90%+ reduction in YouTube API quota usage for video discovery
- [ ] Ability to monitor 50+ channels efficiently
- [ ] Processing time under 30 seconds for 20 channels
- [ ] Error rate below 5% for RSS feed fetching
- [ ] Zero duplicate video imports

## Dependencies
- XML parsing library (fast-xml-parser recommended)
- Existing YouTube API integration
- Current database schema and Supabase setup
- Existing tools tab infrastructure

---

**Last Updated**: 2025-07-04  
**Status**: Planning Phase  
**Estimated Completion**: 2-3 weeks