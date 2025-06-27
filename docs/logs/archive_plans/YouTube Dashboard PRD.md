Product Requirements Document: Make or Break Shop YouTube Analytics Dashboard

## Overview
A custom YouTube analytics dashboard specifically for the "Make or Break Shop" channel that aggregates channel performance data, enables content pattern analysis, and provides exportable context for AI-assisted content creation decisions.

## Background
Brandon currently relies on manual analysis of YouTube Studio data and bounces between multiple tools when planning content. The existing video-scripter codebase has excellent foundations with 173 "Make or Break Shop" videos already stored, complete YouTube OAuth integration, and robust database infrastructure. This dashboard will be a completely separate section from the existing database management interface, focused solely on Brandon's channel analytics and daily workflow needs.

## Success Metrics
- **Primary**: Reduced time to access relevant analytics context (from 15+ min to <2 min)
- **Secondary**: Improved content decision confidence through pattern visibility
- **Long-term**: Increased video performance through data-driven decisions

## User Stories

### Core Use Cases
1. **Daily Check-in**: "I want to quickly see how my recent videos are performing vs my benchmarks"
2. **Content Planning**: "I need to export my analytics context to ask Claude for video recommendations"
3. **Pattern Recognition**: "I want to see which content types and formats are working best for my channel"
4. **Performance Tracking**: "I need to monitor if my latest video is trending up/down vs expected"

## Product Requirements

### Phase 1: Data Foundation (MVP)
**Timeline: 2-3 weeks**

#### Core Features
- **YouTube Analytics Integration**
  - Upgrade existing OAuth to include YouTube Analytics API (`yt-analytics.readonly` scope)
  - Pull detailed analytics: CTR, retention, daily views, revenue estimates
  - Backfill historical analytics for existing 173 "Make or Break Shop" videos
  - Manual refresh button for immediate updates (automated refresh in future phases)

- **Separate Dashboard Section**
  - New `/app/dashboard/youtube` route completely separate from existing database page
  - Channel overview cards: 30-day performance vs channel averages
  - Recent videos performance table with advanced metrics (CTR, retention, daily trends)
  - Performance comparison charts and trend indicators

- **Context Export System**
  - **Phase 1**: CSV exports of video performance data
  - **Phase 2**: Transcript/script text exports for selected video ranges
  - **Phase 3**: Thumbnail image collections as ZIP downloads
  - **Phase 4**: Combined PDF reports with performance charts
  - Direct file downloads (not integrated with existing AI analysis pipeline)

#### Technical Requirements
- Extend existing Supabase schema with `daily_analytics` table (preserve existing `videos` table)
- Build on current Next.js/Radix UI architecture with existing chart components
- Upgrade YouTube OAuth scopes from basic readonly to include Analytics API
- Leverage existing 173 videos in database for immediate backfill

#### Success Criteria
- All video performance data successfully imported
- Dashboard loads in <2 seconds
- Export generates useful context file for Claude conversations

### Phase 2: Content Intelligence (4-6 weeks post-MVP)
**Timeline: 3-4 weeks**

#### Core Features
- **Content Classification**
  - AI analysis to categorize videos (buying guide, review, tutorial, etc.)
  - Extract title patterns and identify successful formulas
  - Thumbnail analysis: colors, text, face presence

- **Pattern Dashboard**
  - Content type performance breakdown
  - Title formula success rates
  - Thumbnail element correlation with CTR

- **Enhanced Exports**
  - Thumbnail collections by performance
  - Script/transcript exports
  - Pattern-based recommendations

#### Technical Requirements
- Integration with OpenAI/Claude APIs for content analysis
- Vector storage for transcript analysis (leverage existing setup)
- Image analysis capabilities for thumbnails

### Phase 3: Competitive Intelligence (Future)
**Timeline: TBD**

#### Core Features
- Expand analysis to external video database (300+ videos)
- Industry trend identification
- Competitive performance benchmarking

## Technical Architecture

### Current Infrastructure Leveraged
**Existing Database:**
- 173 "Make or Break Shop" videos already stored in `videos` table
- Complete OAuth setup with `youtube.readonly` and `youtube.force-ssl` scopes
- Radix UI component library with chart components ready
- Next.js 15 App Router architecture established

### Database Schema Extensions
```sql
-- New table to add alongside existing videos table
CREATE TABLE daily_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id TEXT NOT NULL REFERENCES videos(id),
  date DATE NOT NULL,
  views INTEGER NOT NULL,
  ctr FLOAT,
  retention_avg FLOAT,
  likes INTEGER,
  comments INTEGER,
  revenue_estimate FLOAT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(video_id, date)
);

-- Phase 2: Content classifications (future)
CREATE TABLE content_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id TEXT NOT NULL REFERENCES videos(id),
  content_type TEXT NOT NULL,
  confidence_score FLOAT,
  title_patterns JSONB,
  thumbnail_elements JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### API Integration Strategy
- **YouTube Analytics API**: Upgrade OAuth scopes to access CTR, retention, daily metrics
- **Current YouTube Data API v3**: Continue using for basic metadata (already working)
- **Single Channel Focus**: Only "Make or Break Shop" channel data
- **No Background Jobs**: Manual refresh with button (no job processing system needed)

### Data Refresh Strategy - REVISED
- **Manual Refresh**: "Refresh Analytics" button on dashboard
- **Backfill Strategy**: Historical data import for existing 173 videos
- **Future Automation**: Vercel cron jobs for daily refresh (Phase 2)

## UI/UX Requirements

### Dashboard Layout - `/app/dashboard/youtube`
```
┌─ Make or Break Shop Channel Overview ───┐
│ Last 30 Days: 847K views | 4.8% CTR    │
│ Trending: ↑ 12% vs previous month      │
│ [Refresh Analytics] [Export Data]       │
└─────────────────────────────────────────┘

┌─ Recent Videos Performance ─────────────┐
│ [Video] [Views] [CTR] [Retention] [Trend]│
│ ...173 videos with daily analytics...   │
│ [Select Range for Export]               │
└─────────────────────────────────────────┘

┌─ Performance Charts ────────────────────┐
│ [Views Over Time] [CTR Trends]          │
│ [Top Performers] [Content Types]        │
└─────────────────────────────────────────┘
```

### Export Formats - Layered Implementation
**Phase 1: CSV Performance Data**
```csv
video_id,title,published_date,views,ctr,retention_avg,likes,comments
8ZA0RWhbusk,"Is THIS the Future of Printing?",2025-04-25,46557,4.2,0.68,1191,89
REd2eR_aauo,"Which Fiber Laser Should YOU Buy?",2025-02-06,19873,3.8,0.72,491,67
...
```

**Phase 2: Transcript Text Export**
- Selected date range of videos
- Plain text transcript files
- Organized by publication date

**Phase 3: Thumbnail Collections**
- ZIP download of thumbnail images
- Organized by performance tiers (high/medium/low CTR)
- Filename includes performance metrics

**Phase 4: PDF Analytics Report**
- Combined performance charts
- Top/bottom performer analysis
- Trend analysis with visualizations

## Risk Assessment

### Technical Risks - REVISED
- **YouTube Analytics API Access**: OAuth scope upgrade required for CTR/retention data
  - *Mitigation*: Test Analytics API access early, fallback to Data API metrics if needed
- **API Quota Limits**: 173 videos + daily refresh could hit quotas
  - *Mitigation*: Manual refresh prevents runaway API usage, smart batching for backfill
- **Data Volume**: Historical analytics for 173 videos
  - *Mitigation*: Start with 90-day lookback, expand gradually

### Product Risks - REVISED
- **Scope Creep**: Dashboard could become too complex vs daily check-in goal
  - *Mitigation*: Focus on 4 core metrics: Views, CTR, Retention, Trends
- **Export Utility**: CSV/file exports might not integrate well with workflow
  - *Mitigation*: Start with simple CSV, iterate based on actual usage patterns

## Dependencies - UPDATED

### External (Already Available)
- YouTube OAuth already configured (need scope upgrade)
- Supabase database with 173 videos pre-loaded
- Next.js 15 + Radix UI components ready
- Chart.js integration via shadcn/ui available

### Internal (Leveraged)
- Use existing `videos` table structure (173 videos)
- Add `daily_analytics` table alongside existing schema
- Build on existing sidebar navigation pattern
- No job processing system needed (manual refresh)

## Out of Scope (Phase 1) - REVISED
- Multi-channel support (single "Make or Break Shop" channel only)
- Automated daily refresh (manual refresh button only)
- AI-powered content classification
- Advanced thumbnail analysis or downloads
- Competitive video analysis (300+ external videos)
- Integration with existing AI analysis pipeline
- Mobile app interface
- Real-time notifications or alerts

## Success Definition - UPDATED
**Phase 1 Complete When:**
- Brandon can access all 173 "Make or Break Shop" video analytics in dedicated dashboard
- Manual refresh successfully pulls latest YouTube Analytics API data
- CSV export generates useful performance data for external analysis
- Dashboard loads in <2 seconds with 173 videos displayed
- Tool provides CTR, retention, and daily view trends not available in database page

**Implementation Milestones:**
1. **Week 1**: YouTube Analytics API OAuth upgrade + `daily_analytics` table
2. **Week 2**: Basic dashboard UI with existing video data + manual refresh
3. **Week 3**: Analytics backfill + CSV export + performance charts

**Long-term Success:**
- Reduced daily analytics checking time from 15+ minutes to <2 minutes
- Data-driven content decisions using exported analytics context
- Clear visibility into video performance patterns and trends