# YouTube Thumbnail Generator - Technical Specification

## Executive Summary
A web-based thumbnail generation tool using Google's Gemini 2.5 Flash Image API (Nano Banana) optimized for YouTube creators. Enables rapid iteration with template and freeform prompt modes, reference image management, and parallel generation queuing.

## Core Requirements

### User Goals
- Generate 10+ thumbnail variants in under 2 minutes
- Maintain consistent facial likeness across generations
- Test variations (colors, backgrounds, expressions) efficiently
- Download max quality images for Photoshop finishing

### Technical Constraints
- 2000 API credits/day limit (~$80/day at $0.04/image)
- 1-4 images per API call
- Stateless API (no conversation memory)
- ~1024px max dimension output

## Architecture

### Tech Stack
- **Frontend**: Next.js 14+ (App Router)
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage
- **API**: Gemini 2.5 Flash Image Preview
- **Authentication**: Supabase Auth
- **Styling**: Tailwind CSS

### Data Model

```sql
-- Projects for organizing video thumbnails
projects (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  name TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)

-- Reference images (faces, products, backgrounds)
reference_images (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  temp_name TEXT, -- img1, img2, etc.
  image_url TEXT NOT NULL,
  storage_path TEXT,
  label TEXT, -- user-defined label
  usage_count INTEGER DEFAULT 0,
  file_size INTEGER,
  dimensions JSONB, -- {width, height}
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Many-to-many relationship for project references
project_references (
  project_id UUID REFERENCES projects ON DELETE CASCADE,
  reference_image_id UUID REFERENCES reference_images ON DELETE CASCADE,
  position INTEGER, -- for img1-5 quick access slots
  pinned_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (project_id, reference_image_id)
)

-- Prompt templates for reuse
prompt_templates (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  name TEXT,
  template_text TEXT NOT NULL,
  variables JSONB, -- {shirt_color: ["red", "blue"], etc}
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Style tags for prompt enhancement
style_tags (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  name TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  category TEXT, -- lighting/camera/style/mood
  usage_count INTEGER DEFAULT 0,
  is_global BOOLEAN DEFAULT false
)

-- Generation sessions
generations (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects,
  user_id UUID REFERENCES auth.users,
  prompt TEXT NOT NULL,
  prompt_variables JSONB, -- {shirt_color: ["red", "blue"]}
  reference_images_used UUID[], -- array of reference_image ids
  generation_mode TEXT, -- template/freeform
  template_id UUID REFERENCES prompt_templates,
  batch_id UUID, -- groups related generations
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Individual generated images
generated_images (
  id UUID PRIMARY KEY,
  generation_id UUID REFERENCES generations ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  storage_path TEXT,
  variable_values JSONB, -- {shirt_color: "red", expression: "excited"}
  aspect_ratio TEXT, -- 16:9, 1:1, etc.
  is_favorited BOOLEAN DEFAULT false,
  favorited_at TIMESTAMPTZ,
  api_response JSONB, -- full API response for debugging
  generation_time_ms INTEGER,
  credits_used INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Queue management
generation_queue (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  project_id UUID REFERENCES projects,
  prompt TEXT NOT NULL,
  prompt_variables JSONB,
  reference_images UUID[],
  status TEXT DEFAULT 'pending', -- pending/processing/completed/failed
  priority INTEGER DEFAULT 0,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Indexes for performance
CREATE INDEX idx_generated_images_project ON generated_images(generation_id);
CREATE INDEX idx_generated_images_favorited ON generated_images(is_favorited) WHERE is_favorited = true;
CREATE INDEX idx_generations_project ON generations(project_id);
CREATE INDEX idx_generations_created ON generations(created_at DESC);
CREATE INDEX idx_reference_images_user ON reference_images(user_id);
CREATE INDEX idx_queue_status ON generation_queue(status, priority DESC);
```

## User Interface

### Layout Structure

```
┌─────────────────────────────┬─────────────────────────────┐
│     PROMPT PANEL (Left)     │    RESULTS PANEL (Right)    │
├─────────────────────────────┼─────────────────────────────┤
│ Project: [Dropdown]         │ Filter: [All/Starred/Today] │
│                             │                             │
│ [Template] [Freeform] Mode  │ Sort: [Newest/Rating/Prompt]│
│                             │                             │
│ Prompt Input:               │ ┌───┐ ┌───┐ ┌───┐ ┌───┐   │
│ [........................]  │ │   │ │   │ │   │ │   │   │
│ [........................]  │ └───┘ └───┘ └───┘ └───┘   │
│                             │ ★★★☆☆ ★★★★☆ ★☆☆☆☆ ★★★★★   │
│ References: [@img1 @img2]   │                             │
│                             │ ┌───┐ ┌───┐ ┌───┐ ┌───┐   │
│ Variables:                  │ │   │ │   │ │   │ │   │   │
│ {shirt}: [red, blue, ...]   │ └───┘ └───┘ └───┘ └───┘   │
│                             │                             │
│ Aspect: [16:9 ▼]           │ [Load More]                 │
│ Count: [4 ▼]               │                             │
│                             │ Hover Actions:              │
│ [Generate] or Enter         │ [★][↓][🗑][+][⋮]           │
│                             │                             │
│ Queue (2 active, 3 pending) │ Credits Used Today: 127     │
│ ▶ 75% "Holding laser..."    │                             │
│ ▶ 25% "Product shot..."     │                             │
│ ⏸ "Workshop background..."  │                             │
└─────────────────────────────┴─────────────────────────────┘
```

### Component Specifications

#### Prompt Panel Components

**Mode Toggle**
```typescript
interface PromptMode {
  mode: 'template' | 'freeform';
  activeTemplate?: UUID;
}
```

**Template Mode**
- Structured fields with dropdowns
- Subject selector (img1-5 references)
- Action dropdown (holding/using/showcasing)
- Product selector (img1-5 references)
- Background field (text or dropdown)
- Style tag multi-select

**Freeform Mode**
- Rich text input with @ and { trigger detection
- @ triggers reference image dropdown with previews
- { triggers variable insertion with inline definition
- Syntax highlighting for references and variables
- Auto-save to draft every 5 seconds

**Reference Selector**
```typescript
interface ReferenceSelector {
  projectReferences: Reference[]; // img1-5 pinned
  globalReferences: Reference[];  // all others
  recentlyUsed: Reference[];      // last 10 used
  
  onSelect: (ref: Reference) => void;
  onUpload: (file: File) => Promise<Reference>;
  onPin: (ref: Reference, position: 1-5) => void;
}
```

**Variable System**
```typescript
interface Variable {
  name: string;
  values: string[];
  currentIndex?: number;
}

interface VariableExpander {
  variables: Variable[];
  expandPrompt: (prompt: string) => string[];
  calculatePermutations: () => number;
}
```

#### Results Panel Components

**Thumbnail Grid**
```typescript
interface ThumbnailGrid {
  images: GeneratedImage[];
  viewMode: 'grid' | 'list' | 'compare';
  columns: 2 | 3 | 4 | 'auto';
  
  onStar: (id: UUID, rating: 1-5) => void;
  onDownload: (id: UUID, quality: 'max' | 'web') => void;
  onDelete: (id: UUID) => void;
  onAddToProject: (id: UUID, projectId: UUID) => void;
  onViewFullscreen: (id: UUID) => void;
}
```

**Progressive Loading**
- Skeleton placeholders during generation
- Fade-in animation on completion
- Loading progress indicator per image
- Batch completion notifications

#### Queue Management

**Queue Display**
```typescript
interface QueueManager {
  maxParallel: 2;
  items: QueueItem[];
  
  onReorder: (items: QueueItem[]) => void;
  onCancel: (id: UUID) => void;
  onEditPending: (id: UUID, prompt: string) => void;
  onRetry: (id: UUID) => void;
}
```

## API Integration

### Gemini API Service

```typescript
interface GeminiService {
  generateImage(params: {
    prompt: string;
    referenceImages?: string[]; // base64 or URLs
    aspectRatio?: '1:1' | '4:3' | '3:4' | '16:9' | '9:16';
    count?: 1 | 2 | 3 | 4;
  }): Promise<GeneratedImage[]>;

  // Batch processing for variables
  generateBatch(params: {
    basePrompt: string;
    variables: Variable[];
    referenceImages?: string[];
    aspectRatio?: string;
  }): Promise<BatchResult>;
}

class GeminiAPIClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  private readonly model = 'gemini-2.5-flash-image-preview';
  
  async generateContent(prompt: string, images: Base64Image[]): Promise<Response> {
    const contents = [
      {
        parts: [
          { text: this.injectImageReferences(prompt, images) },
          ...images.map(img => ({
            inline_data: {
              mime_type: img.mimeType,
              data: img.data
            }
          }))
        ]
      }
    ];
    
    return fetch(`${this.baseUrl}/models/${this.model}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ contents })
    });
  }
  
  private injectImageReferences(prompt: string, images: Base64Image[]): string {
    // Replace @img1 with "the person from img1"
    // Replace @img2 with "the product from img2"
    return prompt.replace(/@img(\d+)/g, (match, num) => {
      const index = parseInt(num) - 1;
      if (images[index]) {
        return `the ${images[index].label || 'reference'} from img${num}`;
      }
      return match;
    });
  }
}
```

### Queue Processing

```typescript
class QueueProcessor {
  private activeJobs: Map<UUID, AbortController> = new Map();
  private readonly MAX_PARALLEL = 2;
  
  async processQueue() {
    while (true) {
      if (this.activeJobs.size >= this.MAX_PARALLEL) {
        await this.waitForSlot();
      }
      
      const nextItem = await this.getNextQueueItem();
      if (!nextItem) {
        await this.sleep(1000);
        continue;
      }
      
      this.processItem(nextItem);
    }
  }
  
  private async processItem(item: QueueItem) {
    const controller = new AbortController();
    this.activeJobs.set(item.id, controller);
    
    try {
      await this.updateStatus(item.id, 'processing');
      
      const results = await this.geminiService.generateImage({
        prompt: item.prompt,
        referenceImages: item.referenceImages,
        signal: controller.signal
      });
      
      await this.saveResults(item, results);
      await this.updateStatus(item.id, 'completed');
      
    } catch (error) {
      await this.handleError(item, error);
    } finally {
      this.activeJobs.delete(item.id);
    }
  }
}
```

## Features

### Core Workflows

#### 1. Quick Generation Flow
```
1. User types prompt with @img1 reference
2. Hits Enter → prompt clears, moves to queue
3. Generation starts immediately (if under parallel limit)
4. User types next prompt while first generates
5. Results appear progressively in right panel
6. User stars favorites without interrupting flow
```

#### 2. Variable Testing Flow
```
1. User enters: "Person wearing {color} shirt"
2. Defines {color}: ["red", "blue", "black", "white"]
3. System shows: "Will generate 4 images"
4. Generates all variants in single batch
5. Results grouped by variable value
6. Easy comparison view for A/B testing
```

#### 3. Reference Management Flow
```
1. Upload images → automatically assigned img1, img2, etc.
2. Pin frequently used images to project slots
3. Type @ to see all available references
4. Images show preview + usage count
5. Global images available across all projects
```

### Keyboard Shortcuts
- `Enter` - Generate and clear prompt
- `Cmd+Enter` - Generate and keep prompt
- `@` - Trigger reference selector
- `{` - Trigger variable creation
- `1-5` - Quick star rating on selected image
- `Cmd+D` - Download selected image
- `Cmd+K` - Quick project switcher
- `Esc` - Close modals/fullscreen view

### Progressive Enhancement
1. **Initial Load**: Show last 20 generated images
2. **Infinite Scroll**: Load more as user scrolls
3. **Live Updates**: WebSocket/polling for queue status
4. **Optimistic UI**: Show pending state immediately
5. **Error Recovery**: Auto-retry failed generations

## Performance Optimizations

### Image Handling
```typescript
// Lazy load images not in viewport
const ImageGrid = () => {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          loadImage(entry.target);
        }
      });
    },
    { rootMargin: '100px' }
  );
  
  return images.map(img => (
    <div ref={el => observer.observe(el)}>
      <ImagePlaceholder />
    </div>
  ));
};

// Progressive image loading
const loadImage = async (element: Element) => {
  // Load thumbnail first (blur-up technique)
  const thumb = await fetch(getThumbnailUrl(element.dataset.id));
  element.src = thumb;
  
  // Then load full image
  const full = await fetch(getFullImageUrl(element.dataset.id));
  element.src = full;
};
```

### Caching Strategy
- **Reference Images**: Cache in IndexedDB for offline access
- **Generated Thumbnails**: Memory cache with LRU eviction
- **Prompts**: LocalStorage for draft recovery
- **API Responses**: 5-minute cache for regeneration

### Database Queries
```sql
-- Optimized query for loading project images
WITH project_refs AS (
  SELECT ri.*, pr.position
  FROM reference_images ri
  JOIN project_references pr ON ri.id = pr.reference_image_id
  WHERE pr.project_id = $1
),
recent_generations AS (
  SELECT gi.*, g.prompt, g.created_at as generated_at
  FROM generated_images gi
  JOIN generations g ON gi.generation_id = g.id
  WHERE g.project_id = $1
  ORDER BY g.created_at DESC
  LIMIT 50
)
SELECT 
  'reference' as type, id, image_url, label, position
FROM project_refs
UNION ALL
SELECT 
  'generated' as type, id, image_url, prompt as label, null as position
FROM recent_generations;
```

## Error Handling

### API Errors
```typescript
class APIErrorHandler {
  handle(error: GeminiAPIError): ErrorRecovery {
    switch(error.code) {
      case 'RATE_LIMIT':
        return {
          action: 'queue',
          delay: error.retryAfter || 60000,
          message: 'Rate limited, queuing for later'
        };
      
      case 'INVALID_IMAGE':
        return {
          action: 'skip',
          message: 'Reference image invalid, regenerating without it'
        };
      
      case 'QUOTA_EXCEEDED':
        return {
          action: 'stop',
          message: 'Daily quota exceeded, try tomorrow'
        };
      
      default:
        return {
          action: 'retry',
          maxRetries: 3,
          backoff: 'exponential'
        };
    }
  }
}
```

### Client-Side Recovery
- Auto-save prompts to LocalStorage every 5 seconds
- Restore queue state on page refresh
- Reconnect WebSocket on disconnect
- Offline mode with queued actions

## Cost Management

### Credit Tracking
```typescript
interface CreditManager {
  dailyLimit: 2000;
  warningThreshold: 1800;
  
  getCurrentUsage(): Promise<number>;
  getRemainingCredits(): number;
  getProjectedCost(): number; // Based on queue
  shouldWarnUser(): boolean;
  canGenerate(count: number): boolean;
}

// Display component
const CreditDisplay = () => {
  const { used, remaining, cost } = useCreditTracking();
  
  return (
    <div className="credit-tracker">
      <span>Today: {used}/2000 credits</span>
      <span>~${cost.toFixed(2)}</span>
      {remaining < 200 && (
        <Alert>Low credits: {remaining} remaining</Alert>
      )}
    </div>
  );
};
```

## Deployment

### Environment Variables
```env
# API Keys
GEMINI_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=

# Feature Flags
ENABLE_PARALLEL_GENERATION=true
MAX_PARALLEL_JOBS=2
MAX_QUEUE_SIZE=10
AUTO_RETRY_ERRORS=true

# Limits
DAILY_CREDIT_LIMIT=2000
MAX_IMAGE_SIZE_MB=10
MAX_REFERENCE_IMAGES=100

# Storage
STORAGE_BUCKET=thumbnails
CDN_URL=
```

### Infrastructure
- **Hosting**: Vercel (Next.js optimized)
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage + CDN
- **Queue**: Vercel Functions + Upstash Redis
- **Monitoring**: Vercel Analytics + Sentry

### Deployment Steps
```bash
# Install dependencies
npm install

# Run database migrations
npm run migrate

# Build application
npm run build

# Deploy to Vercel
vercel deploy --prod

# Set up cron jobs for cleanup
vercel cron add cleanup --schedule "0 2 * * *"
```

## Future Enhancements (v2+)

### Priority Features
1. **Seed Control**: Lock seed for consistent variations
2. **Batch Download**: ZIP all starred images
3. **Prompt Library**: Share/import prompt templates
4. **CTR Tracking**: Connect YouTube Analytics
5. **Auto-Archive**: Clean old unstarred images

### Technical Improvements
1. **WebSocket Queue**: Real-time updates
2. **Edge Functions**: Reduce latency
3. **Image CDN**: Cloudflare Images integration
4. **Vector Search**: Pinecone for similarity
5. **Prompt Optimization**: Fine-tune successful patterns

### Integration Points
1. **YouTube API**: Direct upload capability
2. **Photoshop Plugin**: Send directly to PS
3. **Figma Plugin**: Design system integration
4. **Slack Bot**: Team collaboration
5. **Mobile App**: iOS/Android companion

## Success Metrics

### Primary KPIs
- Time to 10 thumbnails: < 2 minutes
- Successful generation rate: > 95%
- Average stars per session: > 2
- Daily active usage: > 5 days/week

### Technical Metrics
- API response time: < 3s per image
- Queue processing time: < 10s wait
- Page load time: < 1s
- Error rate: < 1%

## Integration Plan for Video Scripter Codebase

### Project Structure
```
/app/thumbnail-generator/
  page.tsx                      # Main interface
  layout.tsx                    # Layout wrapper
  
/app/api/thumbnail-generator/
  generate/route.ts             # Direct Gemini API calls
  upload-reference/route.ts     # Handle reference uploads
  projects/route.ts             # Project management
  templates/route.ts            # Prompt templates

/lib/
  gemini-api.ts                 # Gemini API client (follows anthropic-api.ts pattern)
  thumbnail-storage-service.ts  # Supabase Storage handling

/components/thumbnail-generator/
  prompt-panel.tsx              # Left panel
  results-grid.tsx              # Right panel
  reference-manager.tsx         # @img handling
  queue-display.tsx             # Show pending generations
```

### Integration Decisions

1. **Gemini API**: Add to `.env` as `GEMINI_API_KEY`
2. **Storage**: Use Supabase Storage with 2 buckets:
   - `thumbnail-references` - uploaded reference images
   - `thumbnail-generated` - AI-generated outputs
3. **Database**: Hybrid approach - separate thumbnail projects with optional video linking
4. **Authentication**: Will be implemented separately as part of full auth system
5. **Workers**: Start with direct API calls, add worker infrastructure later if needed

### Simplified Database Schema for MVP
```sql
-- Core tables only, add to existing Supabase
CREATE TABLE thumbnail_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  video_id UUID REFERENCES videos(id), -- Optional link to video
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reference_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  temp_name TEXT,  -- img1, img2, etc.
  storage_path TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE generations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES thumbnail_projects(id),
  prompt TEXT NOT NULL,
  reference_images_used UUID[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE generated_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  generation_id UUID REFERENCES generations(id),
  storage_path TEXT NOT NULL,
  is_favorited BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Environment Variables
```env
# Add to existing .env
GEMINI_API_KEY=your_gemini_api_key_here
THUMBNAIL_DAILY_LIMIT=2000
THUMBNAIL_STORAGE_BUCKET_REFERENCES=thumbnail-references
THUMBNAIL_STORAGE_BUCKET_GENERATED=thumbnail-generated
```

### MVP Implementation Priority

**Phase 1 - Core Generation**
- Gemini API integration
- Basic prompt input
- Display generated images
- Simple reference image upload

**Phase 2 - Enhanced Features**
- Variable expansion `{color}`
- Reference management `@img1`
- Favorites/starring
- Project organization

**Phase 3 - Optimization**
- Queue visualization
- Prompt templates
- Batch operations
- Worker integration (if needed)

### Key Simplifications for MVP
- No authentication initially (add later)
- Direct API calls (no workers)
- Simple credit tracking in localStorage
- Basic error handling
- Manual refresh for queue status

## Conclusion

This specification provides a comprehensive blueprint for building a YouTube thumbnail generator optimized for rapid iteration and high-quality output. The focus on parallel processing, smart reference management, and seamless Photoshop integration creates a tool that fits naturally into a professional creator's workflow.

The architecture is designed to scale from MVP to full production system while maintaining performance and usability as the primary goals. The integration plan ensures smooth compatibility with the existing video scripter codebase while maintaining clean separation of concerns.