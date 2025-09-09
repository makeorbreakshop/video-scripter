# YouTube Thumbnail Generator - Implementation Todo List

## Phase 1: Foundation & Core Infrastructure

### 1. Environment Setup
- [ ] Add `GEMINI_API_KEY` to `.env`
- [ ] Add `THUMBNAIL_DAILY_LIMIT=2000` to `.env`
- [ ] Add `THUMBNAIL_STORAGE_BUCKET_REFERENCES=thumbnail-references` to `.env`
- [ ] Add `THUMBNAIL_STORAGE_BUCKET_GENERATED=thumbnail-generated` to `.env`
- [ ] Update `.env.example` with new variables

### 2. Database Schema
- [ ] Create migration file for thumbnail tables
- [ ] Create `thumbnail_projects` table
  - [ ] id, name, video_id (optional), created_at fields
  - [ ] Add foreign key to videos table
- [ ] Create `reference_images` table
  - [ ] id, temp_name, storage_path, label, created_at fields
- [ ] Create `generations` table
  - [ ] id, project_id, prompt, reference_images_used[], created_at fields
- [ ] Create `generated_images` table
  - [ ] id, generation_id, storage_path, is_favorited, created_at fields
- [ ] Add indexes for performance
  - [ ] idx_generated_images_project
  - [ ] idx_generated_images_favorited
  - [ ] idx_generations_project
  - [ ] idx_generations_created
- [ ] Run migration in Supabase
- [ ] Test database connections

### 3. Supabase Storage Setup
- [ ] Create `thumbnail-references` bucket in Supabase Storage
  - [ ] Set appropriate access policies
  - [ ] Configure max file size limits
- [ ] Create `thumbnail-generated` bucket in Supabase Storage
  - [ ] Set appropriate access policies
  - [ ] Configure retention policies
- [ ] Test upload/download functionality

### 4. API Integration Layer

#### Gemini API Client (`lib/gemini-api.ts`)
- [ ] Create GeminiAPI class structure
- [ ] Implement constructor with API key validation
- [ ] Add generateImage method
  - [ ] Handle prompt formatting
  - [ ] Support reference image injection
  - [ ] Handle aspect ratio options
  - [ ] Parse API responses
- [ ] Add error handling
  - [ ] Rate limiting
  - [ ] Invalid image errors
  - [ ] Quota exceeded errors
- [ ] Add retry logic with exponential backoff
- [ ] Implement cost tracking
- [ ] Add logging for debugging

#### Storage Service (`lib/thumbnail-storage-service.ts`)
- [ ] Create ThumbnailStorageService class
- [ ] Implement uploadReference method
  - [ ] Handle file validation
  - [ ] Generate unique paths
  - [ ] Upload to Supabase Storage
  - [ ] Return public URLs
- [ ] Implement saveGeneratedImage method
  - [ ] Download from Gemini URL
  - [ ] Save to Supabase Storage
  - [ ] Handle path organization by date
- [ ] Implement getPublicUrl method
- [ ] Implement deleteImage method
- [ ] Add error handling for storage operations

## Phase 2: Core UI Components

### 5. Page Structure

#### Main Layout (`app/thumbnail-generator/layout.tsx`)
- [ ] Create responsive two-panel layout
- [ ] Add keyboard shortcut provider
- [ ] Set up theme/styling context
- [ ] Add error boundary

#### Main Page (`app/thumbnail-generator/page.tsx`)
- [ ] Create main container component
- [ ] Implement state management for:
  - [ ] Current project
  - [ ] Generation queue
  - [ ] Reference images
  - [ ] Generated images
  - [ ] Credit usage
- [ ] Add keyboard shortcut handlers
- [ ] Implement auto-save to localStorage

### 6. Prompt Panel Components (`components/thumbnail-generator/`)

#### Prompt Panel (`prompt-panel.tsx`)
- [ ] Create main panel container
- [ ] Add project selector dropdown
- [ ] Implement mode toggle (template/freeform)
- [ ] Add prompt input area
  - [ ] Rich text support
  - [ ] @ trigger for references
  - [ ] { trigger for variables
  - [ ] Syntax highlighting
- [ ] Add reference image display
- [ ] Add variable editor
- [ ] Add aspect ratio selector
- [ ] Add image count selector
- [ ] Add Generate button
- [ ] Implement Enter key handling

#### Reference Manager (`reference-manager.tsx`)
- [ ] Create reference image grid
- [ ] Implement upload functionality
  - [ ] Drag and drop support
  - [ ] File validation
  - [ ] Progress indicators
- [ ] Add temp_name assignment (img1, img2, etc.)
- [ ] Implement @ mention dropdown
  - [ ] Search/filter functionality
  - [ ] Preview images
  - [ ] Usage counter
- [ ] Add pin/unpin functionality
- [ ] Add delete confirmation

#### Variable System Components
- [ ] Create variable input component
- [ ] Implement variable value editor
- [ ] Add permutation calculator
- [ ] Show expansion preview
- [ ] Add variable validation

### 7. Results Panel Components

#### Results Grid (`results-grid.tsx`)
- [ ] Create responsive image grid
- [ ] Implement lazy loading with IntersectionObserver
- [ ] Add progressive image loading (blur-up)
- [ ] Add hover actions overlay
  - [ ] Star rating (1-5)
  - [ ] Download button
  - [ ] Delete button
  - [ ] Fullscreen view
- [ ] Implement infinite scroll
- [ ] Add filter options (All/Starred/Today)
- [ ] Add sort options (Newest/Rating/Prompt)

#### Queue Display (`queue-display.tsx`)
- [ ] Create queue status component
- [ ] Show active generations with progress
- [ ] Show pending items
- [ ] Add cancel button for pending
- [ ] Add retry button for failed
- [ ] Show credits used counter
- [ ] Add daily limit warning

## Phase 3: API Routes

### 8. API Endpoints (`app/api/thumbnail-generator/`)

#### Generate Route (`generate/route.ts`)
- [ ] Create POST endpoint
- [ ] Validate request parameters
- [ ] Check daily credit limits
- [ ] Call Gemini API
- [ ] Handle reference image encoding
- [ ] Save generation record to database
- [ ] Save generated images to storage
- [ ] Return generation results
- [ ] Handle errors gracefully

#### Upload Reference Route (`upload-reference/route.ts`)
- [ ] Create POST endpoint for file upload
- [ ] Validate file type and size
- [ ] Upload to Supabase Storage
- [ ] Create database record
- [ ] Assign temp_name
- [ ] Return reference details

#### Projects Route (`projects/route.ts`)
- [ ] GET - List user projects
- [ ] POST - Create new project
- [ ] PUT - Update project
- [ ] DELETE - Delete project
- [ ] Handle project-video linking

#### Templates Route (`templates/route.ts`)
- [ ] GET - List prompt templates
- [ ] POST - Save new template
- [ ] PUT - Update template
- [ ] DELETE - Delete template

## Phase 4: Enhanced Features

### 9. Advanced Prompt Features

#### Template Mode
- [ ] Create structured template builder
- [ ] Add dropdown fields for common options
- [ ] Implement style tag system
- [ ] Add template saving
- [ ] Add template sharing preparation

#### Variable Expansion
- [ ] Implement variable parser
- [ ] Create batch generation for variables
- [ ] Group results by variable value
- [ ] Add comparison view
- [ ] Implement A/B testing view

### 10. Credit & Cost Management
- [ ] Create credit tracking system
- [ ] Implement daily limit checking
- [ ] Add cost calculation ($0.04/image)
- [ ] Create usage dashboard
- [ ] Add warning notifications
- [ ] Implement quota reset logic

### 11. Performance Optimizations

#### Caching
- [ ] Implement IndexedDB for reference images
- [ ] Add memory cache for thumbnails
- [ ] Cache prompts in localStorage
- [ ] Add 5-minute API response cache

#### Image Optimization
- [ ] Generate thumbnail versions
- [ ] Implement progressive loading
- [ ] Add WebP support
- [ ] Optimize storage paths

## Phase 5: Polish & UX

### 12. User Experience Enhancements
- [ ] Add loading skeletons
- [ ] Implement smooth animations
- [ ] Add toast notifications
- [ ] Create onboarding flow
- [ ] Add tooltips for features
- [ ] Implement dark mode support

### 13. Error Handling & Recovery
- [ ] Add comprehensive error boundaries
- [ ] Implement auto-retry for failures
- [ ] Add offline mode detection
- [ ] Create error recovery UI
- [ ] Add detailed error logging

### 14. Keyboard Shortcuts
- [ ] Implement Enter for generate
- [ ] Add Cmd+Enter for generate & keep
- [ ] Add @ trigger handler
- [ ] Add { trigger handler
- [ ] Implement 1-5 for star rating
- [ ] Add Cmd+D for download
- [ ] Add Cmd+K for project switcher
- [ ] Add Esc for modal close

## Phase 6: Testing & Documentation

### 15. Testing
- [ ] Write unit tests for Gemini API client
- [ ] Test storage service methods
- [ ] Test API route handlers
- [ ] Add integration tests
- [ ] Test error scenarios
- [ ] Test rate limiting
- [ ] Test file upload limits
- [ ] Browser compatibility testing

### 16. Documentation
- [ ] Create user guide
- [ ] Document API endpoints
- [ ] Add code comments
- [ ] Create troubleshooting guide
- [ ] Document keyboard shortcuts
- [ ] Add example prompts

## Phase 7: Future Enhancements (Post-MVP)

### 17. Authentication System
- [ ] Implement user registration
- [ ] Add login/logout
- [ ] Create user profiles
- [ ] Add role-based access
- [ ] Implement API keys

### 18. Advanced Features
- [ ] Add worker infrastructure for queue
- [ ] Implement WebSocket for real-time updates
- [ ] Add batch download (ZIP)
- [ ] Create prompt library
- [ ] Add seed control for consistency
- [ ] Implement similarity search
- [ ] Add CTR tracking integration

### 19. Integrations
- [ ] YouTube API integration for direct upload
- [ ] Connect to video performance data
- [ ] Add Photoshop plugin preparation
- [ ] Implement sharing features
- [ ] Add team collaboration

### 20. Monitoring & Analytics
- [ ] Add usage analytics
- [ ] Implement error tracking (Sentry)
- [ ] Add performance monitoring
- [ ] Create admin dashboard
- [ ] Add cost reports

## Development Checklist

### Before Starting
- [ ] Review spec document
- [ ] Set up local environment
- [ ] Get Gemini API key
- [ ] Configure Supabase project

### During Development
- [ ] Follow existing code patterns
- [ ] Maintain TypeScript types
- [ ] Keep components modular
- [ ] Document as you go
- [ ] Test incrementally

### Before Launch
- [ ] Security review
- [ ] Performance audit
- [ ] Accessibility check
- [ ] Cross-browser testing
- [ ] Load testing
- [ ] Error monitoring setup

## Success Criteria
- [ ] Generate 10+ thumbnails in < 2 minutes
- [ ] 95%+ successful generation rate
- [ ] < 3s API response time per image
- [ ] < 1s page load time
- [ ] < 1% error rate
- [ ] Consistent facial likeness maintained
- [ ] Variable testing functional
- [ ] Reference management smooth
- [ ] Daily limit enforcement working
- [ ] Storage organized and accessible

## Notes
- Start with Phase 1-3 for MVP
- Authentication can be added later
- Worker infrastructure optional initially
- Focus on core generation first
- Iterate based on user feedback