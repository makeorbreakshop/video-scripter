# Analytics API Migration TODO

## Migration Overview
Switch from YouTube Reporting API to YouTube Analytics API for daily analytics collection to gain access to critical metrics (impressions, CTR) not available in Reporting API data.

## Current State Analysis

### Database State
- **daily_analytics**: 6,676 records (176 videos, May 7-June 25, 2025)
- **baseline_analytics**: 327 records (lifetime totals, collected June 26, 2025)
- **Schema**: 43-field structure already compatible with Analytics API data
- **Data source**: Currently populated via Reporting API (4 CSV reports)

### Infrastructure Already Available
- ✅ OAuth authentication with token refresh
- ✅ Analytics API client (`youtube-analytics-api.ts`)
- ✅ Database service with upsert logic (`analytics-db-service.ts`)
- ✅ 43-field schema supports Analytics API data
- ✅ Error handling and retry logic

### Key Missing Metrics (Reason for Migration)
- **Video Impressions**: How many times thumbnail shown
- **Thumbnail CTR**: Critical for content optimization
- **Real-time data**: Analytics API provides current-day data

## Phase 1: Data Cleanup & Preparation

### 1.1 Clear Current Daily Analytics Data
- [x] **Backup existing data** (export to CSV for reference)
- [x] **Truncate daily_analytics table** to start fresh
- [x] **Verify baseline_analytics remains intact** (lifetime data preservation)

### 1.2 Update Database Schema (Add Critical Missing Metrics)
- [x] **Add impressions & CTR columns** (PRIMARY MISSING METRICS):
  - [x] `impressions INTEGER` - How many times thumbnail was shown
  - [x] `impressions_ctr_rate FLOAT` - Thumbnail click-through rate (CRITICAL)
- [x] **Add advanced engagement metrics**:
  - [x] `engaged_views INTEGER` - Views lasting 4+ seconds (quality metric)
  - [x] `viewer_percentage FLOAT` - % of logged-in viewers
- [x] **Add enhanced revenue metrics**:
  - [x] `playback_based_cpm FLOAT` - Revenue per 1000 playbacks
- [x] **Add advanced retention metrics**:
  - [x] `audience_watch_ratio JSONB` - Detailed retention curve data
  - [x] `relative_retention_performance FLOAT` - Retention vs similar videos
- [x] **Add live stream metrics** (if applicable):
  - [x] `average_concurrent_viewers INTEGER`
  - [x] `peak_concurrent_viewers INTEGER`
- [x] **Update indexes** for new impression/CTR columns
- [x] **Test schema with sample Analytics API data**

## Phase 2: Analytics API Daily Collection Service

### 2.1 Create Analytics API Daily Import Service
- [x] **Build new service class** (`/lib/youtube-analytics-daily.ts`)
  - [x] Fetch core metrics: views, impressions, CTR, watch time
  - [x] Handle 173 video daily collection (optimal batch sizes)
  - [x] Include rate limiting (avoid quota exhaustion)
  - [x] Progress tracking for UI feedback
  - [x] Comprehensive error handling

### 2.2 Optimize for Key Metrics
- [x] **Define critical metric set** for daily collection:
  - [x] Views, impressions, impressions_ctr_rate
  - [x] estimatedMinutesWatched, averageViewDuration, averageViewPercentage
  - [x] likes, comments, shares, subscribersGained
  - [x] Device breakdown, traffic sources
- [x] **Test quota usage** per video (target: 1-2 units max)
- [x] **Implement metric prioritization** (core vs optional)

### 2.3 Create Daily Import API Endpoint
- [x] **Build new endpoint** (`/app/api/youtube/analytics/daily-import/route.ts`)
  - [x] Replace Reporting API endpoint functionality
  - [x] Accept date parameter for specific day import
  - [x] Return progress and quota usage info
  - [x] Handle authentication and token refresh
- [x] **Add batch processing logic** for 173 videos
- [x] **Implement progress tracking** for long-running operations
- [x] **Add comprehensive error responses**

## Phase 3: Historical Backfill Strategy

### 3.1 Historical Data Collection (Flexible Date Range)
- [x] **Calculate quota requirements**: Flexible for any date range
- [x] **Create backfill endpoint** (`/app/api/youtube/analytics/historical-backfill/route.ts`)
- [x] **Implement date range processing** (any start/end date combination)
- [x] **Add resume capability** for interrupted backfills
- [x] **Progress tracking** with ETA calculations

### 3.2 Backfill Execution Strategy
- [ ] **Test with small date range** (1-2 days) first
- [ ] **Optimize batch sizes** to avoid rate limits
- [ ] **Monitor quota usage** during execution
- [ ] **Validate data quality** vs existing Reporting API data
- [ ] **Execute historical backfill** for desired date range

## Phase 4: Frontend Updates

### 4.1 Update Analytics Data Table
- [ ] **Modify data table** to show new Analytics API metrics
  - [ ] Add Impressions column
  - [ ] Add CTR column (impressions → clicks)
  - [ ] Update existing columns for Analytics API data
  - [ ] Add date range filtering (50 days max)
- [ ] **Update API calls** to use new Analytics API endpoints
- [ ] **Handle loading states** for longer processing times

### 4.2 Update Tools Tab Interface
- [ ] **Replace Reporting API controls** with Analytics API controls
- [ ] **Update quota estimates** (173 units/day vs 6-8 units/day)
- [ ] **Add daily import trigger** for manual execution
- [ ] **Update progress indicators** for Analytics API timing

### 4.3 Update Dashboard Overview
- [ ] **Modify overview calculations** to use Analytics API data
- [ ] **Add impression-based metrics** to overview cards
- [ ] **Update trend calculations** for new data source
- [ ] **Test all dashboard components** with Analytics API data

## Phase 5: Performance Optimization

### 5.1 Quota Management
- [ ] **Implement quota monitoring** and usage tracking
- [ ] **Add quota alerts** when approaching limits
- [ ] **Optimize API calls** to minimize quota usage
- [ ] **Consider caching strategies** for frequently accessed data

### 5.2 Processing Performance
- [ ] **Optimize batch sizes** for 173 video daily processing
- [ ] **Implement parallel processing** where possible
- [ ] **Add processing time estimates** for UI feedback
- [ ] **Monitor and optimize database performance**

### 5.3 Error Handling & Reliability
- [ ] **Comprehensive error handling** for API failures
- [ ] **Retry logic** with exponential backoff
- [ ] **Graceful degradation** for partial failures
- [ ] **Monitoring and alerting** for system health

## Phase 6: Testing & Validation

### 6.1 Data Quality Testing
- [ ] **Compare Analytics API vs Reporting API** data samples
- [ ] **Validate new metrics** (impressions, CTR) accuracy
- [ ] **Test date range filtering** functionality
- [ ] **Verify database performance** with new data volume

### 6.2 System Testing
- [ ] **End-to-end testing** of daily import process
- [ ] **Load testing** for 173 video daily collection
- [ ] **UI testing** for new Analytics API features
- [ ] **Error scenario testing** (quota limits, API failures)

### 6.3 User Acceptance Testing
- [ ] **Dashboard functionality** with real Analytics API data
- [ ] **Date range filtering** usability
- [ ] **Performance testing** for dashboard responsiveness
- [ ] **Content planning workflow** validation

## Phase 7: Deployment & Monitoring

### 7.1 Production Deployment
- [ ] **Deploy new Analytics API services** to production
- [ ] **Execute historical backfill** (8,650 quota units)
- [ ] **Switch daily operations** from Reporting API to Analytics API
- [ ] **Monitor system performance** post-deployment

### 7.2 Ongoing Operations
- [ ] **Schedule daily Analytics API import** (173 units/day)
- [ ] **Monitor quota usage** trends
- [ ] **Performance monitoring** and optimization
- [ ] **Regular data quality checks**

## Files to Modify/Create

### New Files
- `/lib/youtube-analytics-daily.ts` - Daily Analytics API service
- `/app/api/youtube/analytics/daily-import/route.ts` - New daily import endpoint
- `/app/api/youtube/analytics/historical-backfill/route.ts` - Historical backfill endpoint

### Modified Files
- `/components/youtube/analytics-data-table.tsx` - Add impressions/CTR columns, date filtering
- `/components/youtube/tools-tab.tsx` - Update for Analytics API controls
- `/app/dashboard/youtube/page.tsx` - Update for new data source
- `/components/youtube/channel-overview-cards.tsx` - Add impression-based metrics
- Database schema files if needed

### Deprecated Files
- `/app/api/youtube/reporting/daily-import/route.ts` - Reporting API endpoint
- `/lib/youtube-csv-parser.ts` - CSV parsing logic
- Other Reporting API specific services

## Success Criteria

### Functional Success
- [ ] **173 videos daily collection** completing in <15 minutes
- [ ] **Daily quota usage** under 400 units (4% of daily limit)
- [ ] **All critical metrics available**: views, impressions, CTR, watch time
- [ ] **50 days historical data** successfully imported
- [ ] **Dashboard performance** comparable to current system

### Strategic Success
- [ ] **Content planning enhanced** with impression/CTR data
- [ ] **Thumbnail optimization** enabled with CTR analytics
- [ ] **Real-time insights** available for current-day performance
- [ ] **Comprehensive analytics** surpassing previous Reporting API dataset

## Risk Mitigation

### Quota Management
- **Risk**: Exceeding daily quota limits
- **Mitigation**: Careful batch sizing, monitoring, and alerting

### Performance Impact
- **Risk**: Slower daily processing (API calls vs CSV download)
- **Mitigation**: Optimize batch processing, parallel execution, progress tracking

### Data Quality
- **Risk**: Inconsistent data compared to Reporting API
- **Mitigation**: Parallel testing, data validation, fallback procedures

### System Reliability
- **Risk**: API failures affecting daily operations
- **Mitigation**: Comprehensive error handling, retry logic, manual fallback options

## Timeline Estimate
- **Phase 1-2**: 2-3 days (cleanup + core service)
- **Phase 3**: 1-2 days (backfill implementation)
- **Phase 4**: 2-3 days (frontend updates)
- **Phase 5-6**: 2-3 days (optimization + testing)
- **Phase 7**: 1 day (deployment)
- **Total**: 8-12 days for complete migration

## Investment Summary
- **Quota Cost**: 8,650 units for historical backfill (one-time)
- **Ongoing Cost**: 173 units/day (1.73% of daily quota)
- **Strategic Value**: Impressions + CTR data for content optimization
- **Timeline**: 8-12 days for complete migration