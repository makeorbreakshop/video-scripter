# Idea Heist Sales Page - Implementation TODO

## Project Overview
Build a high-converting sales page for the Idea Heist database product ($99 one-time purchase) using the existing game's design language (dark greys/blacks with green accents) while following landing page best practices.

## Design System Setup

### Color Palette (60-30-10 Rule)
- [ ] **60% Neutral (Backgrounds)**:
  - [ ] `bg-gray-900` (main background)
  - [ ] `bg-black` (section variations)
- [ ] **30% Secondary (UI Elements)**:
  - [ ] `bg-gray-800` (cards/surfaces)
  - [ ] `bg-gray-700` (hover states)
  - [ ] `border-gray-700` (borders)
  - [ ] `text-gray-300` (secondary text)
- [ ] **10% Accent (CTAs & Highlights)**:
  - [ ] `bg-blue-600` (primary CTAs - semantic action color)
  - [ ] `bg-blue-700` (CTA hover)
  - [ ] `bg-green-500` (success states only)
  - [ ] `text-green-400` (accent highlights - test contrast!)

### Typography (1.25x Major Third Scale)
- [ ] **Font Stack**: 
  ```css
  --font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-display: 'Inter', var(--font-sans);
  ```
- [ ] **Type Scale** (stick to these exactly):
  - [ ] Hero: `text-4xl` (3.052rem/49px) with `font-bold`
  - [ ] Section heads: `text-3xl` (2.441rem/39px) with `font-semibold`
  - [ ] Subheadings: `text-xl` (1.563rem/25px) with `font-semibold`
  - [ ] Body: `text-base` (1rem/16px) with `font-normal`
  - [ ] Small: `text-sm` (0.875rem/14px) with `font-normal`
  - [ ] **Line heights**: 1.2 for headings, 1.5 for body
  - [ ] **Only use weights**: 400 (normal), 600 (semibold), 700 (bold)

## Component Development

### 1. Hero Section
- [ ] **Above Fold Requirements** (ALL 4 MUST BE VISIBLE):
  - [ ] Value proposition (headline)
  - [ ] Primary CTA
  - [ ] Trust signal ("Join 127 creators")
  - [ ] Form/button
- [ ] **Headline Component**
  - [ ] "A giant list of YouTube videos that actually worked."
  - [ ] `text-4xl font-bold text-gray-100`
- [ ] **Trust Signal** (MOVE TO TOP)
  - [ ] "Join 127 creators already using this" (above subheadline)
- [ ] **Subheadline**
  - [ ] `text-gray-300` for contrast
- [ ] **Primary CTA Button**
  - [ ] `bg-blue-600 hover:bg-blue-700`
  - [ ] **First-person copy**: "Get MY Access — $99" (90% lift proven)
  - [ ] **Minimum 44px height** (mobile conversions)
  - [ ] Sticky bottom bar on mobile
  - [ ] Focus state: `focus-visible:outline-2 focus-visible:outline-blue-500`

### 2. Interactive Preview Section (HIGH PRIORITY)
- [ ] **Reuse Existing Table Component** (don't rebuild!)
  - [ ] Update colors from light to dark theme:
    - [ ] `bg-white` → `bg-gray-900` (main background)
    - [ ] `bg-gray-50` → `bg-gray-800` (alt rows/hover)
    - [ ] `border-gray-200` → `border-gray-700`
    - [ ] `text-gray-900` → `text-gray-100` (primary text)
    - [ ] `text-gray-700` → `text-gray-300` (secondary text)
  - [ ] **Filter bar updates**:
    - [ ] White dropdowns → `bg-gray-800 text-gray-100 border-gray-600`
    - [ ] Refresh button → `bg-blue-600 hover:bg-blue-700` (not green!)
  - [ ] **Keep score badges as-is** (red/orange/green for data viz is fine)
- [ ] **Progressive Disclosure**
  - [ ] Show only 10-15 rows initially
  - [ ] "Show More" button to reveal up to 50 total
- [ ] **Lock Overlay**
  - [ ] Semi-transparent overlay after final rows
  - [ ] "🔒 Showing 50 of 500,000+ videos" message
  - [ ] CTA button: "Unlock Full Access" with `bg-blue-600`

### 3. Personal Story Section
- [ ] **"Why I Made This" Container**
  - [ ] Dark card with subtle border
  - [ ] Personal avatar/photo (optional)
  - [ ] Story text with good line-height
  - [ ] Screenshot of old spreadsheet (before)
  - [ ] Screenshot of new dashboard (after)

### 4. Features Grid
- [ ] **Card Components** (3-column desktop, stack mobile)
  - [ ] "500,000+ Videos" card
  - [ ] "Browse & Sort" card
  - [ ] "Always Fresh" card
  - [ ] "One-time Unlock" card
- [ ] **Card Design**
  - [ ] Gray-800 background
  - [ ] Green accent icons
  - [ ] Hover lift effect
  - [ ] Clear value propositions

### 5. Social Proof Section
- [ ] **Testimonial Cards** (if available)
  - [ ] User avatar
  - [ ] Quote text
  - [ ] User title/channel
- [ ] **Stats Bar**
  - [ ] Number of users (even if starting small)
  - [ ] Videos analyzed counter
  - [ ] Daily updates indicator

### 6. Pricing Comparison
- [ ] **Comparison Table**
  - [ ] "Idea Heist vs Monthly Tools"
  - [ ] Highlight $99 one-time vs $50+/month
  - [ ] Green checkmarks for features
  - [ ] Emphasis on no subscription

### 7. FAQ Section
- [ ] **Accordion Component** (shadcn/ui)
  - [ ] Dark theme styling
  - [ ] Common objections addressed:
    - [ ] "What exactly do I get?"
    - [ ] "How is this updated?"
    - [ ] "Is this a subscription?"
    - [ ] "What's your refund policy?"
    - [ ] "Who is this for?"

### 8. Final CTA Section  
- [ ] **CTA Button**
  - [ ] `bg-blue-600` (not green!)
  - [ ] **First-person**: "Unlock MY Vault — $99"
  - [ ] 44px minimum height
- [ ] **Simple Urgency** (don't overcomplicate)
  - [ ] "Test pricing ends Sunday" (if true)
  - [ ] Skip complex counters/progress bars
- [ ] **Trust Elements**
  - [ ] "7-day money back guarantee"
  - [ ] Stripe badge only (familiar = trusted)

## HIGH-IMPACT ADDITIONS (80/20 Focus)

### Critical Conversion Boosters
- [ ] **2-Step Checkout** (3x conversion proven)
  - [ ] Step 1: Email only form ("Claim Your Access")
  - [ ] Step 2: Payment page (Stripe)
  - [ ] This captures leads even without purchase
- [ ] **Email Capture Fallback**
  - [ ] Exit intent popup: "Get 10 Free Examples"
  - [ ] Simple email form, no payment
  - [ ] Recovers 2-7% of abandoners
- [ ] **Page Load Speed** (<3 seconds or lose 53%)
  - [ ] WebP format for ALL thumbnails
  - [ ] Lazy load below fold
  - [ ] Skeleton loader for table

### Spacing System (Consistency)
- [ ] **Use Stack Primitive** for all sections:
  ```css
  .stack > * + * {
    margin-block-start: 2rem; /* 32px between sections */
  }
  ```
- [ ] Apply to main page wrapper - automatic consistent spacing

## Technical Implementation

### Page Structure
- [ ] Create `/app/idea-heist/page.tsx`
- [ ] Dark theme by default
- [ ] Import shadcn/ui Table and Button only (keep it simple)

### Data Integration
- [ ] **Sample Data API**
  - [ ] Endpoint to fetch 50 sample videos
  - [ ] Include thumbnail URLs
  - [ ] Performance score calculations
- [ ] **Live Stats API**
  - [ ] Total video count
  - [ ] Daily update count
  - [ ] User count (if tracking)

### Performance Optimizations
- [ ] **Image Optimization**
  - [ ] Next.js Image component for thumbnails
  - [ ] WebP format with fallbacks
  - [ ] Lazy loading below fold
- [ ] **Code Splitting**
  - [ ] Dynamic import for table component
  - [ ] Separate bundle for FAQ section
- [ ] **Core Web Vitals**
  - [ ] LCP < 2.5s (hero text/image)
  - [ ] CLS < 0.1 (fixed heights for images)
  - [ ] FID < 100ms (optimize interactivity)

### Mobile Optimizations
- [ ] **Touch Targets**
  - [ ] Minimum 44x44px for all interactive elements
  - [ ] Proper spacing between clickable items
- [ ] **Responsive Design**
  - [ ] Single column layout on mobile
  - [ ] Bottom-fixed CTA button
  - [ ] Swipeable table on mobile
- [ ] **Performance**
  - [ ] Reduce JavaScript payload for mobile
  - [ ] Optimize images for mobile screens

## Conversion Optimization

### A/B Testing Setup
- [ ] **Test Variations**
  - [ ] Headline variations
  - [ ] CTA button text
  - [ ] Price display format
  - [ ] Urgency messaging
- [ ] **Tracking Setup**
  - [ ] Page view events
  - [ ] Scroll depth tracking
  - [ ] CTA click events
  - [ ] Table interaction events

### Analytics Implementation
- [ ] **Event Tracking**
  - [ ] Hero CTA clicks
  - [ ] Table preview interactions
  - [ ] FAQ expansions
  - [ ] Exit intent detection
- [ ] **Conversion Tracking**
  - [ ] Purchase completions
  - [ ] Cart abandonment
  - [ ] Time on page
  - [ ] Bounce rate

### Trust & Security
- [ ] **SSL Certificate** verification
- [ ] **Payment Integration**
  - [ ] Stripe checkout
  - [ ] Secure payment badges
  - [ ] PCI compliance
- [ ] **Privacy Policy** link
- [ ] **Terms of Service** link
- [ ] **Contact Information** visible

## Copy & Microcopy

### Headlines & CTAs
- [ ] Primary headline implemented
- [ ] Subheadline with personal touch
- [ ] CTA variations:
  - [ ] "Unlock 500,000+ Winners — $99"
  - [ ] "Get Instant Access — $99"
  - [ ] "Claim Your Vault — $99"

### Value Propositions
- [ ] Clear benefit statements
- [ ] No monthly fees messaging
- [ ] Updates included forever
- [ ] Instant access emphasis

### Objection Handling
- [ ] Address pricing concerns
- [ ] Clarify what's included
- [ ] Emphasize one-time payment
- [ ] Highlight refund policy

## Testing Checklist

### Functionality
- [ ] Table preview loads correctly
- [ ] Search/filter works in preview
- [ ] All CTAs link to checkout
- [ ] Mobile navigation works
- [ ] Forms submit properly

### Cross-Browser
- [ ] Chrome/Edge
- [ ] Safari
- [ ] Firefox
- [ ] Mobile Safari
- [ ] Chrome Mobile

### Performance
- [ ] PageSpeed Insights score > 90
- [ ] GTmetrix grade A
- [ ] Mobile load time < 3s
- [ ] No layout shifts

### Accessibility
- [ ] Keyboard navigation
- [ ] Screen reader compatible
- [ ] ARIA labels present
- [ ] Color contrast passes WCAG AA

## Launch Checklist

### Pre-Launch
- [ ] Legal pages ready (Privacy, Terms)
- [ ] Payment processing tested
- [ ] Email notifications setup
- [ ] Support system ready
- [ ] Refund process documented

### Launch Day
- [ ] Monitoring dashboards active
- [ ] Error tracking enabled
- [ ] Customer support briefed
- [ ] Social media announcements ready
- [ ] Email campaign prepared

### Post-Launch
- [ ] Monitor conversion rates
- [ ] Gather user feedback
- [ ] Address any bugs quickly
- [ ] Optimize based on data
- [ ] Plan feature additions

## Success Metrics

### Primary KPIs
- [ ] Conversion rate > 2.5% (industry average)
- [ ] Average time on page > 2 minutes
- [ ] Bounce rate < 40%
- [ ] Mobile conversion rate > 2%

### Secondary Metrics
- [ ] Table interaction rate > 60%
- [ ] FAQ engagement > 30%
- [ ] Scroll depth > 80%
- [ ] Return visitor rate

## Technical Stack

### Required Dependencies
```json
{
  "dependencies": {
    "@radix-ui/react-accordion": "latest",
    "@radix-ui/react-progress": "latest",
    "@tanstack/react-table": "latest",
    "class-variance-authority": "latest",
    "clsx": "latest",
    "framer-motion": "latest",
    "lucide-react": "latest",
    "tailwind-merge": "latest"
  }
}
```

### File Structure
```
/app/idea-heist/
  ├── page.tsx (main page)
  ├── components/
  │   ├── hero-section.tsx
  │   ├── preview-table.tsx
  │   ├── features-grid.tsx
  │   ├── faq-section.tsx
  │   └── cta-section.tsx
  └── api/
      ├── sample-data/route.ts
      └── stats/route.ts
```

## Simplified Timeline (80/20 Approach)

### Day 1-2: Core Page
- Hero with proper hierarchy
- Interactive table (10 rows initially)
- 2-step checkout form
- Mobile responsive

### Day 3-4: Conversion Essentials  
- Email capture popup
- Page speed optimization (WebP, lazy load)
- First-person CTA copy
- Stack spacing system

### Day 5: Launch
- Stripe integration
- Basic analytics
- Deploy

## 80/20 Focus Points

**DO THESE FIRST (Biggest Impact):**
1. **2-step checkout** = 3x conversion
2. **First-person CTAs** = 90% lift  
3. **10 rows initially** = reduce overwhelm
4. **44px button height** = mobile conversions
5. **Stack spacing** = consistent design with 3 lines of CSS

**SKIP THESE (Overengineering):**
- Complex animations
- Multiple font weights
- Fancy shadows/gradients
- Progress bars and counters
- A/B testing setup (do it manually first)

**REMEMBER:**
- Blue for CTAs (not green) - semantic meaning matters
- "Join 127 creators" must be above fold
- Page must load in <3 seconds or you lose half your traffic
- Email capture is not optional - you're leaving money without it