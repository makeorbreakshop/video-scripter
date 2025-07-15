# Video Discovery UI Specification

## Overview
A dual-axis discovery system that helps content creators find successful video patterns across topics and formats, with a focus on cross-niche insights and performance metrics.

## Design Principles
1. **Progressive Disclosure**: Start simple, reveal complexity as needed
2. **Visual First**: Lead with thumbnails and visual patterns
3. **Performance-Driven**: Surface metrics that matter to creators
4. **Cross-Pollination**: Highlight opportunities from adjacent niches
5. **Mobile-Responsive**: Full functionality on all devices

## Layout Structure

### Desktop Layout (1440px+)
```
┌─────────────────────────────────────────────────────────────────┐
│ Header: Video Discovery Dashboard                               │
│ [Search Bar] [Save View] [Export]                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ┌───────────────┬───────────────────────────────────────────┐ │
│ │               │                                             │ │
│ │  Filter       │         Main Content Area                  │ │
│ │  Sidebar      │                                             │ │
│ │  (280px)      │         (Fluid)                            │ │
│ │               │                                             │ │
│ └───────────────┴───────────────────────────────────────────┘ │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Insights Bar (Collapsible)                                  │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Mobile Layout (< 768px)
- Filter sidebar becomes bottom sheet
- Results stack vertically
- Insights appear as cards between results

## Component Specifications

### 1. Filter Sidebar

#### Topic Filter (Hierarchical Tree)
```
Topics ─────────────────────────────── [Clear]

▼ DIY & Crafts (1,234)
  ▼ Woodworking (456)
    □ Hand Tools (123)
    ☑ Power Tools (89)
    □ Joinery (67)
  ▶ Laser Cutting (234)
  ▶ 3D Printing (189)

[+ Add Custom Topic]
```

**Features:**
- Collapsible tree structure with counts
- Multi-select checkboxes
- Search within topics
- Custom topic creation
- Visual indicators for "hot" topics (🔥)

#### Format Filter (Visual Grid)
```
Formats ────────────────────────────── [Clear]

┌────┬────┬────┬────┐
│ 🎓 │ 🔨 │ 📋 │ 🎬 │
│Tut │How │List│Vlog│
├────┼────┼────┼────┤
│ 📊 │ 🆚 │ 💡 │ 🎯 │
│Rev │Comp│Expl│Chal│
├────┼────┼────┼────┤
│ 🎨 │ 🗣️ │ 📰 │ 🎭 │
│Show│Int │News│Ent │
└────┴────┴────┴────┘
```

**Features:**
- Icon-based format grid
- Multi-select toggles
- Hover shows format name + description
- Selected formats highlighted in brand color

#### Performance Filters
```
Performance ──────────────────────────

Views (30-day avg)
[====|===========] 10K - 1M

Engagement Rate
[========|=======] 5% - 15%

Growth Velocity
[=====|==========] 2x - 10x

□ Rising Stars (>50% growth)
□ Proven Winners (>90th percentile)
□ Hidden Gems (<10K views, >10% engagement)
```

### 2. Main Content Area

#### View Toggle
```
[Grid View] [List View] [Analytics View] [Heatmap]
```

#### Grid View (Default)
```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│             │             │             │             │
│ Thumbnail   │ Thumbnail   │ Thumbnail   │ Thumbnail   │
│             │             │             │             │
│ Title...    │ Title...    │ Title...    │ Title...    │
│ Channel     │ Channel     │ Channel     │ Channel     │
│             │             │             │             │
│ 234K views  │ 567K views  │ 123K views  │ 890K views  │
│ 12.3% eng   │ 8.9% eng    │ 15.2% eng   │ 9.1% eng    │
│             │             │             │             │
│ [🎓 Tut]    │ [🔨 How-to] │ [📋 List]   │ [🎬 Vlog]   │
│ Woodworking │ Laser Cut   │ 3D Print    │ DIY Craft   │
└─────────────┴─────────────┴─────────────┴─────────────┘
```

**Card Features:**
- Thumbnail with duration overlay
- Title (2 lines max)
- Channel name with subscriber count on hover
- Key metrics (views, engagement rate)
- Format badge and primary topic tag
- Hover actions: Save, Analyze, Similar

#### List View
```
┌────┬─────────────────────────────────────────────┬────────┬────────┬─────┐
│ 📷 │ How to Build a CNC Router from Scratch      │ 234K   │ 12.3%  │ ⋮   │
│    │ Make Everything • Woodworking > Power Tools │ views  │ eng    │     │
├────┼─────────────────────────────────────────────┼────────┼────────┼─────┤
│ 📷 │ 10 Laser Cutting Projects That Sell         │ 567K   │ 8.9%   │ ⋮   │
│    │ Crafty Panda • Laser Cutting > Business     │ views  │ eng    │     │
└────┴─────────────────────────────────────────────┴────────┴────────┴─────┘
```

#### Analytics View
Interactive scatter plot with:
- X-axis: Upload date
- Y-axis: Performance metric (views/engagement)
- Bubble size: Video length
- Color: Format type
- Hover: Full video details

#### Heatmap View
```
        Tutorial  How-to  List  Review  Comparison ...
DIY      ████     ███     ██    █████    ██
Wood     ████     █████   █     ███      ████
Laser    ██       ████    ███   ██       █████
3D       ███      ██      ████  █████    ██
```

### 3. Insights Bar

#### Opportunity Cards
```
┌─────────────────────────────────────────────────────────────┐
│ 💡 Cross-Niche Opportunity                                  │
│                                                             │
│ "List" videos in Laser Cutting are getting 3.2x more       │
│ engagement than tutorials. Top performer: "10 Things You    │
│ Can Make and Sell"                                         │
│                                                             │
│ [Explore List Videos] [Dismiss]                             │
└─────────────────────────────────────────────────────────────┘
```

#### Trend Alerts
```
┌─────────────────────────────────────────────────────────────┐
│ 📈 Rising Format                                            │
│                                                             │
│ "Comparison" videos in your niche grew 156% last month.    │
│ Average views: 89K (vs 34K for other formats)              │
│                                                             │
│ [View Examples] [Set Alert]                                 │
└─────────────────────────────────────────────────────────────┘
```

### 4. Interactive Elements

#### Quick Actions Menu (per video)
```
┌──────────────────┐
│ 📊 Analyze       │
│ 💾 Save          │
│ 🔍 Find Similar  │
│ 📈 Track         │
│ 🔗 Share         │
└──────────────────┘
```

#### Bulk Actions Bar
Appears when items selected:
```
[3 videos selected] [Analyze All] [Export] [Create Collection] [Cancel]
```

### 5. Search & Command Bar
```
🔍 Search videos, channels, or topics... [Ctrl+K]

Recent: "laser cutting tutorials" "woodworking comparisons"
```

**Smart Search Features:**
- Natural language queries: "high engagement tutorials from small channels"
- Autocomplete with category indicators
- Search history and saved searches
- Command palette shortcuts

### 6. Visual Design System

#### Color Palette
- **Primary**: #2563EB (Blue - Discovery)
- **Success**: #10B981 (Green - High Performance)
- **Warning**: #F59E0B (Amber - Opportunities)
- **Danger**: #EF4444 (Red - Declining)
- **Neutral**: #6B7280 (Gray - UI Elements)

#### Typography
- **Headings**: Inter 600 (Semi-bold)
- **Body**: Inter 400 (Regular)
- **Metrics**: Mono font for numbers
- **Small text**: 12px minimum for accessibility

#### Spacing System
- Base unit: 4px
- Component padding: 16px
- Card gap: 16px (mobile) / 24px (desktop)
- Section spacing: 32px

### 7. Responsive Behavior

#### Breakpoints
- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px

#### Mobile Adaptations
- Filter sidebar → Bottom sheet with tabs
- Grid view → 1 column
- Insights → Inline cards
- Search → Full-screen overlay

### 8. Performance Considerations

#### Data Loading
- Initial load: 20 items
- Infinite scroll with 20-item batches
- Skeleton screens during loading
- Optimistic UI for selections

#### Caching Strategy
- Cache filter combinations
- Prefetch next page on scroll
- Store user preferences locally

### 9. Accessibility

#### Keyboard Navigation
- Tab through all interactive elements
- Arrow keys for grid navigation
- Escape to close overlays
- Shortcuts for common actions

#### Screen Reader Support
- Descriptive labels for all icons
- ARIA landmarks for sections
- Announcements for dynamic updates

### 10. User Journey: Sarah's Experience

1. **Landing**: Sarah sees popular videos in her saved topics
2. **Exploration**: She expands "Laser Cutting" and notices "3D Printing" has high engagement
3. **Discovery**: She filters by "List" format after seeing the insight
4. **Analysis**: She hovers over top performers to see patterns
5. **Action**: She saves 5 videos to a "Content Ideas" collection
6. **Insight**: System suggests "Comparison" videos are trending in her niche

## Implementation Notes

### Component Library
- Use Radix UI for accessible primitives
- Tailwind CSS for styling
- Framer Motion for transitions
- React Query for data fetching

### State Management
- URL-based filter state for shareability
- Local storage for preferences
- Server-side pagination
- Optimistic updates for interactions

### Performance Metrics
- Time to First Meaningful Paint: < 1.5s
- Time to Interactive: < 3s
- Scroll performance: 60 FPS
- Search response: < 200ms

## Future Enhancements
1. AI-powered "Why this worked" analysis
2. Collaborative collections with team members
3. Automated alerts for format opportunities
4. A/B testing suggestions based on data
5. Export to content calendar integration