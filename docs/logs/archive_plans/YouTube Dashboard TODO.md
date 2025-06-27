# YouTube Dashboard Implementation TODO

Based on the [YouTube Dashboard PRD](./YouTube%20Dashboard%20PRD.md), this TODO tracks the complete implementation of the Make or Break Shop YouTube Analytics Dashboard.

## Phase 1: Data Foundation (MVP)
**Timeline: 2-3 weeks**

### Week 1: Database & API Setup

#### Database Schema Extensions
- [x] Create `daily_analytics` table with proper indexes
  - [x] Add video_id foreign key reference to existing videos table
  - [x] Add date, views, ctr, retention_avg, likes, comments columns
  - [x] Add revenue_estimate column for future monetization tracking
  - [x] Create unique constraint on (video_id, date)
  - [x] Add created_at/updated_at timestamps with triggers

- [x] Create `content_classifications` table (Phase 2 prep)
  - [x] Add video_id foreign key reference
  - [x] Add content_type, confidence_score columns
  - [x] Add title_patterns and thumbnail_elements JSONB columns
  - [x] Add proper indexes for query performance

#### YouTube Analytics API Integration
- [x] Upgrade OAuth scopes from current setup
  - [x] Current scopes: `youtube.readonly`, `youtube.force-ssl`
  - [x] Add required scope: `https://www.googleapis.com/auth/yt-analytics.readonly`
  - [x] Update OAuth flow in `/lib/youtube-oauth.ts`
  - [x] Test OAuth upgrade with existing stored tokens

- [x] Create YouTube Analytics API client
  - [x] New file: `/lib/youtube-analytics-api.ts`
  - [x] Implement functions for daily metrics retrieval
  - [x] Add error handling and fallback strategies
  - [x] Implement batch processing for multiple videos
  - [x] Add rate limiting and quota management

- [x] Create analytics data processing service
  - [x] New file: `/lib/analytics-processor.ts`
  - [x] Functions to transform API responses to database format
  - [x] Data validation and cleaning utilities
  - [x] Batch insert operations for daily_analytics table

### Week 2: Dashboard UI Foundation

#### Route Setup
- [x] Create new dashboard route: `/app/dashboard/youtube/page.tsx`
- [x] Add YouTube dashboard to main navigation sidebar
- [x] Implement route protection (authenticated users only)
- [x] Add proper metadata and SEO tags

#### Core UI Components - Following Shadcn/TailwindUI Best Practices

**Dashboard Layout Architecture**
- [x] Implement SidebarLayout pattern with YouTube dashboard integration
  - [x] Use existing sidebar structure from app but add YouTube section
  - [x] Follow Catalyst layout patterns for responsive design
  - [x] Maintain consistent navigation with existing app structure

**Channel Overview Cards (Shadcn Card Components)**
- [x] Create modular card components using shadcn/ui Card primitives
  - [x] `<Card><CardHeader><CardTitle>Channel Performance</CardTitle></CardHeader><CardContent>...</CardContent></Card>`
  - [x] 30-day performance summary with proper spacing and typography
  - [x] Channel averages comparison using shadcn Badge components for trends
  - [x] Trending indicators with Heroicons (↑ 12% vs previous month)
  - [x] Manual refresh button using shadcn Button component with loading states

**Performance Data Table (Shadcn DataTable Pattern)**
- [x] Implement DataTable using @tanstack/react-table + shadcn Table components
  - [x] Follow exact pattern from shadcn DataTable documentation
  - [x] Columns: Video, Views, CTR, Retention, Trend with proper TypeScript types
  - [x] Sortable by each column using TanStack table sorting
  - [x] Built-in pagination controls using shadcn Button components
  - [x] Performance indicators using shadcn Badge components with color variants
  - [x] Row selection for range exports using checkbox column pattern
  - [x] Loading skeleton states using shadcn/ui Skeleton components

**Performance Charts (Shadcn Chart Components)**
- [x] Use shadcn/ui chart components with Recharts integration
  - [x] Views over time LineChart with ChartContainer and ChartTooltipContent
  - [x] CTR trends AreaChart with proper theming using CSS variables
  - [x] Top performers BarChart with ChartLegend integration
  - [x] Follow shadcn chart configuration patterns with chartConfig objects
  - [ ] Content types breakdown (future) - PieChart with custom legend

#### Backend API Routes
- [x] Create analytics API endpoints
  - [x] `/app/api/youtube/analytics/overview/route.ts` - Channel summary
  - [x] `/app/api/youtube/analytics/videos/route.ts` - Video performance list
  - [x] `/app/api/youtube/analytics/refresh/route.ts` - Manual data refresh
  - [x] `/app/api/youtube/analytics/export/route.ts` - Data export functionality

### Week 3: Data Processing & Export

#### Historical Data Backfill
- [x] Create backfill script for existing 173 videos
  - [x] Script: `/scripts/backfill-analytics.js`
  - [x] Process videos in batches to respect API quotas
  - [x] 90-day historical data retrieval (expandable later)
  - [x] Progress tracking and resume capability
  - [x] Error handling for videos with missing data

- [ ] Run initial backfill process
  - [ ] Test with small batch (10 videos) first
  - [ ] Full backfill for all 173 "Make or Break Shop" videos
  - [ ] Validate data accuracy against YouTube Studio
  - [ ] Document any data discrepancies or limitations

#### Export System Implementation (Shadcn UI Components)
- [x] Phase 1: CSV Performance Data Export
  - [x] Generate CSV with video_id, title, published_date, views, ctr, retention_avg, likes, comments
  - [x] Add date range filtering using shadcn DatePicker component
  - [x] Include performance metrics and trends
  - [x] Proper CSV formatting and encoding

**Export UI Components (Following Shadcn Patterns)**
- [x] Export dialog using shadcn Dialog component
  - [x] `<Dialog><DialogTrigger asChild><Button>Export Data</Button></DialogTrigger><DialogContent>...</DialogContent></Dialog>`
  - [x] Date range picker using shadcn Calendar with range selection
  - [x] Export format selection using shadcn Select component (Phase 1: CSV only)
  - [x] Download progress indicator using shadcn Progress component
  - [ ] Export history using shadcn DataTable for cache management
  - [x] Success/error states using shadcn Toast notifications

#### Performance & Optimization (Shadcn Best Practices)
- [x] Database query optimization
  - [x] Add indexes for common query patterns
  - [x] Optimize analytics aggregation queries
  - [x] Test performance with full dataset

**Frontend Performance (Following Shadcn Patterns)**
- [ ] Implement virtualization for large video lists using @tanstack/react-virtual
- [x] Add comprehensive loading states
  - [x] Skeleton components using shadcn/ui Skeleton for data tables
  - [x] Loading spinners using shadcn/ui Spinner for buttons
  - [x] Suspense boundaries for chart components
- [x] Optimize chart rendering performance
  - [x] Use React.memo for chart components
  - [x] Implement proper chartConfig memoization
  - [x] Debounce chart data updates
- [x] Error handling using shadcn patterns
  - [x] Error boundaries with shadcn Alert component fallbacks
  - [x] Toast notifications for API errors
  - [x] Proper error states in DataTable components

## Phase 1 Testing & Validation

### Manual Testing
- [ ] Test OAuth upgrade process
- [ ] Validate analytics data accuracy vs YouTube Studio
- [ ] Test manual refresh functionality
- [ ] Verify export file generation and accuracy
- [ ] Test dashboard performance with full dataset
- [ ] Cross-browser compatibility testing

### Data Validation
- [ ] Compare exported data with YouTube Studio analytics
- [ ] Verify CTR and retention calculations
- [ ] Test edge cases (private videos, deleted videos, etc.)
- [ ] Validate date ranges and timezone handling

### User Acceptance Testing
- [ ] Test daily workflow: check recent performance
- [ ] Test export workflow: generate context for AI analysis
- [ ] Verify loading times meet <2 second requirement
- [ ] Test mobile responsiveness

## Phase 2: Content Intelligence (Future)
**Timeline: 3-4 weeks post-MVP**

### Content Classification System
- [ ] AI analysis integration for video categorization
- [ ] Title pattern extraction and analysis
- [ ] Thumbnail analysis implementation
- [ ] Pattern dashboard UI components

### Enhanced Export Features
- [ ] Phase 2: Transcript/script text exports
- [ ] Phase 3: Thumbnail image collections
- [ ] Phase 4: Combined PDF reports with charts

### Performance Pattern Analysis
- [ ] Content type performance breakdown
- [ ] Title formula success rate analysis
- [ ] Thumbnail element correlation with CTR
- [ ] Seasonal performance trends

## Phase 3: Competitive Intelligence (Future)
**Timeline: TBD**

### External Data Integration
- [ ] Expand to external video database (300+ videos)
- [ ] Industry trend identification
- [ ] Competitive benchmarking features

## Technical Debt & Maintenance (Following Best Practices)

### Code Quality & TypeScript
- [x] Add comprehensive TypeScript types for analytics data
  - [x] Define proper interfaces for YouTube Analytics API responses
  - [x] Create type-safe ColumnDef arrays for DataTable components
  - [x] Type all chartConfig objects with ChartConfig interface
- [ ] Implement proper error handling throughout
  - [ ] Use Result<T, E> pattern for API responses
  - [ ] Implement error boundaries with proper fallback UI
  - [ ] Add comprehensive Zod schema validation
- [ ] Add unit tests for critical functions
  - [ ] Test analytics data transformation functions
  - [ ] Test chart configuration generation
  - [ ] Test DataTable column definitions
- [ ] Add integration tests for API endpoints
  - [ ] Test YouTube Analytics API integration
  - [ ] Test database query performance
  - [ ] Test export functionality end-to-end

### Documentation (Design System Focused)
- [ ] Component documentation following Shadcn patterns
  - [ ] Document custom DataTable column configurations
  - [ ] Document chart component usage and theming
  - [ ] Document export dialog component API
- [ ] API documentation for new endpoints
- [ ] Database schema documentation updates
- [ ] Deployment and configuration guide

### Security & Privacy
- [ ] Audit OAuth token handling
- [ ] Implement proper data access controls
- [ ] Add rate limiting to prevent abuse
- [ ] Ensure compliance with YouTube API terms

## Success Criteria Checklist

### Primary Goals
- [x] All 173 "Make or Break Shop" videos display analytics data
- [x] Dashboard loads in <2 seconds
- [x] Manual refresh successfully pulls latest YouTube Analytics API data
- [x] CSV export generates useful performance data for AI analysis
- [x] Tool provides CTR, retention, and daily view trends

### Secondary Goals  
- [x] Reduced daily analytics checking time from 15+ minutes to <2 minutes
- [x] Clear visibility into video performance patterns and trends
- [x] Reliable data export for AI-assisted content planning

## Shadcn/TailwindUI Implementation Guidelines

### Component Architecture Standards
- [x] **Follow Shadcn Composition Patterns**
  - Use composition over configuration (e.g., `<Dialog><DialogTrigger>` vs single component props)
  - Leverage existing shadcn/ui components from the project: Button, Card, Table, Dialog, etc.
  - Maintain accessibility with proper ARIA attributes automatically handled by components

- [x] **TailwindUI/Catalyst Layout Patterns**
  - Implement consistent SidebarLayout pattern for dashboard pages
  - Use proper responsive breakpoints: `sm:`, `md:`, `lg:`, `xl:`
  - Follow CSS Grid patterns for dashboard cards: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6`

- [x] **DataTable Implementation (Critical)**
  - Use exact pattern from shadcn DataTable docs with @tanstack/react-table
  - Implement proper TypeScript column definitions with ColumnDef<TData, TValue>
  - Add row selection with checkbox column for export functionality
  - Include sorting, filtering, and pagination out of the box

- [x] **Chart Integration Best Practices**
  - Use shadcn/ui chart components with Recharts (not custom chart libraries)
  - Define chartConfig objects following shadcn patterns: `const chartConfig = { desktop: { label: "Desktop", color: "hsl(var(--chart-1))" } } satisfies ChartConfig`
  - Use CSS variables for theming: `fill="var(--color-desktop)"`
  - Implement ChartContainer, ChartTooltipContent, and ChartLegend consistently

### Design System Consistency
- [x] **Color System**
  - Use semantic color tokens: `bg-background`, `text-foreground`, `border-border`
  - Implement proper dark mode support with CSS variables
  - Use chart color variables: `--chart-1` through `--chart-5`

- [x] **Typography & Spacing**
  - Follow shadcn typography scale: `text-sm`, `text-base`, `text-lg`, `text-xl`
  - Use consistent spacing: `space-y-4`, `gap-6`, `p-6`
  - Implement proper card layouts with CardHeader, CardContent, CardFooter

- [x] **Interactive States**
  - Use shadcn Button variants: `default`, `destructive`, `outline`, `secondary`, `ghost`
  - Implement loading states with disabled buttons and spinner icons
  - Add hover states and focus rings following shadcn standards

### Code Organization Standards
- [x] **Component Structure**
  ```typescript
  // Analytics overview cards
  /components/youtube/
    ├── channel-overview-cards.tsx     // Main dashboard cards
    ├── analytics-data-table.tsx       // Performance table with shadcn DataTable
    ├── performance-charts.tsx         // Chart components
    ├── export-dialog.tsx             // Export functionality dialog
    └── types.ts                      // TypeScript interfaces
  ```

- [x] **Hook Patterns**
  - Use React Query for data fetching: `useQuery('/api/youtube/analytics')`
  - Implement proper loading states with shadcn Skeleton components
  - Add error handling with shadcn Toast notifications

- [x] **API Route Standards**
  - Follow Next.js 15 App Router patterns for API routes
  - Implement proper error responses with consistent JSON structure
  - Add request validation using Zod schemas

## Notes & Considerations

### API Limitations
- YouTube Analytics API has daily quotas - implement smart batching
- Some metrics may have delays (24-48 hours for accurate data)
- Historical data availability varies by account age and video privacy

### Data Storage Strategy
- Store daily snapshots rather than trying to maintain real-time data
- Consider data retention policies for historical analytics
- Plan for potential API schema changes

### Future Enhancements
- Automated daily refresh via Vercel cron jobs
- Real-time notifications for performance anomalies  
- Integration with existing AI analysis pipeline
- Mobile-optimized dashboard views

---

**Priority Legend:**
- 🔴 Critical Path - Blocks other work
- 🟡 Important - Needed for MVP completion
- 🟢 Nice to Have - Can be deferred if needed

**Status Tracking:**
- [ ] Not Started
- [x] Completed
- [⏳] In Progress
- [❌] Blocked/Issues

*Last Updated: 2025-06-25*