# Design Principles & Best Practices

> A comprehensive guide synthesizing leading design frameworks, systems, and methodologies for building exceptional web experiences.

## Table of Contents
1. [Core Principles](#part-1-core-principles)
2. [Visual Hierarchy Framework](#part-2-visual-hierarchy-framework)
3. [System Architecture](#part-3-system-architecture)
4. [Design Tokens & Scales](#part-4-design-tokens--scales)
5. [Implementation Patterns](#part-5-implementation-patterns)
6. [Governance & Evolution](#part-6-governance--evolution)
7. [Performance & Modern Considerations](#part-7-performance--modern-considerations)

---

## Part 1: Core Principles

### The Seven Fundamental Laws

These principles, synthesized from Laws of UX and Don't Make Me Think, form the foundation of every design decision:

#### 1. **Obviousness Over Elegance**
*"Don't make me think" - Steve Krug*

- Users should never wonder what something does or where to click
- Conventions exist for a reason—use them
- Self-evident choices reduce cognitive load
- Test: Can someone use this without instructions?

**Implementation:**
```css
/* Bad: Clever but unclear */
.action-initiator { }

/* Good: Obvious */
.button-primary { }
```

#### 2. **Progressive Disclosure**
*Hick's Law: Time to decide increases with number and complexity of choices*

- Show only what's necessary at each step
- Advanced features should be discoverable but not prominent
- Group related actions to reduce perceived choices
- Use sensible defaults to minimize decisions

**Pattern Example:**
```
Initial View: [Create Project]
↓ Click
Essential Fields: Name, Type
↓ "Advanced Settings" (collapsed)
Optional Fields: Only when needed
```

#### 3. **Fitts's Law in Practice**
*Targets are easier to hit when they're larger and closer*

- Critical actions get larger touch targets (minimum 44×44px mobile, 32×32px desktop)
- Destructive actions are smaller and further from common paths
- Group related actions within 200px of each other
- Click targets extend beyond visible boundaries

```css
/* Extend click area beyond visible button */
.button {
  position: relative;
  padding: 8px 16px;
}
.button::before {
  content: '';
  position: absolute;
  inset: -8px;
}
```

#### 4. **Visual Hierarchy Through Contrast**
*Not everything can be important*

- If everything is bold, nothing is bold
- Create 3-4 levels of emphasis maximum
- Use size, weight, color, and spacing—not just one attribute
- Guide the eye through deliberate contrast

```css
/* Hierarchy levels */
.text-primary   { font-size: 16px; font-weight: 600; color: var(--gray-900); }
.text-secondary { font-size: 14px; font-weight: 400; color: var(--gray-700); }
.text-tertiary  { font-size: 12px; font-weight: 400; color: var(--gray-500); }
```

#### 5. **Consistency Builds Trust**
*Users "satisfice"—they find the first reasonable option*

- Similar things should look similar
- Different things should look obviously different
- Patterns learned in one area apply everywhere
- Breaking consistency requires strong justification

#### 6. **Feedback Is Mandatory**
*Every action needs a reaction*

- Acknowledge every user interaction within 100ms
- Show progress for operations over 1 second
- Confirm destructive actions explicitly
- Error messages must be actionable

#### 7. **Accessibility Is The Baseline**
*From USWDS & React Aria principles*

- Keyboard navigation for everything interactive
- ARIA labels for all non-text content
- Color alone never conveys meaning
- 4.5:1 contrast ratio minimum (7:1 for better readability)

---

## Part 2: Visual Hierarchy Framework

### The Refactoring UI Method

#### Color Philosophy & Principles

**Core Principle: Color Has Jobs**
Every color must serve a specific purpose. Never use color decoratively.

**The 60-30-10 Rule**
- 60% Neutral (backgrounds, surfaces)
- 30% Secondary (UI elements, borders)
- 10% Accent (CTAs, highlights)

```css
/* Example application */
.page {
  background: var(--gray-50);      /* 60% neutral */
  color: var(--gray-900);          /* 30% text/UI */
}
.button-primary {
  background: var(--blue-600);     /* 10% accent */
}
```

**Start With Grayscale**
Begin every design in grayscale to focus on hierarchy without color's influence:

```css
/* Design tokens: Start grayscale */
--gray-50:  #f9fafb;  /* Backgrounds */
--gray-100: #f3f4f6;  /* Hover states */
--gray-200: #e5e7eb;  /* Borders */
--gray-300: #d1d5db;  /* Disabled borders */
--gray-400: #9ca3af;  /* Placeholder text */
--gray-500: #6b7280;  /* Disabled text */
--gray-600: #4b5563;  /* Secondary text */
--gray-700: #374151;  /* Default text */
--gray-800: #1f2937;  /* Emphasized text */
--gray-900: #111827;  /* Headings */
```

**Semantic Color Mapping**
Colors convey meaning consistently across your entire system:

```css
/* Interactive states (User can act) */
--color-interactive-primary: hsl(217, 91%, 60%);    /* Primary actions */
--color-interactive-secondary: transparent;          /* Secondary actions */
--color-interactive-tertiary: hsl(217, 91%, 95%);   /* Subtle actions */

/* System feedback (System responds) */
--color-success: hsl(142, 71%, 45%);   /* Task complete */
--color-warning: hsl(36, 100%, 50%);   /* Needs attention */
--color-error: hsl(347, 86%, 50%);     /* Problem occurred */
--color-info: hsl(209, 100%, 50%);     /* Neutral information */

/* Content states (Content status) */
--color-new: hsl(291, 64%, 50%);       /* New/unread */
--color-modified: hsl(36, 100%, 50%);  /* Changed */
--color-deleted: hsl(347, 86%, 95%);   /* Removed */
```

**Color Accessibility Rules**
1. **Never convey meaning through color alone** - Always pair with icons, text, or patterns
2. **Contrast ratios are non-negotiable**:
   - Normal text: 4.5:1 minimum
   - Large text (18px+): 3:1 minimum  
   - Interactive elements: 3:1 minimum
   - Prefer 7:1 for body text
3. **Test with color blindness simulators** - 8% of men have color vision deficiency
4. **Provide a high contrast mode** - Some users need extreme contrast

#### Typography Principles & System

**Core Typography Principles**

1. **Readability First** - Body text should be 16px minimum on web
2. **Contrast Through Weight** - Use weight variations before size changes
3. **Consistent Rhythm** - Line height creates vertical rhythm (1.5x for body, 1.2x for headings)
4. **Purposeful Fonts** - Maximum 2 font families (one for headings, one for body)

**Font Selection Framework**

```css
/* System font stack for performance */
--font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
--font-mono: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;

/* OR branded fonts with fallbacks */
--font-display: 'Inter', var(--font-sans);  /* Headings */
--font-body: 'Inter', var(--font-sans);      /* Body text */
--font-code: 'JetBrains Mono', var(--font-mono); /* Code */
```

**Why These Fonts?**
- **System fonts**: Zero load time, native feel, excellent rendering
- **Inter**: Designed for screens, excellent legibility at all sizes
- **JetBrains Mono**: Ligatures for code, clear character distinction

**Type Scale (1.25x ratio - Major Third)**
```css
--text-xs:   0.75rem;  /* 12px - Legal text, timestamps */
--text-sm:   0.875rem; /* 14px - Captions, help text */
--text-base: 1rem;     /* 16px - Body text */
--text-lg:   1.25rem;  /* 20px - Lead paragraphs */
--text-xl:   1.563rem; /* 25px - H3 headings */
--text-2xl:  1.953rem; /* 31px - H2 headings */
--text-3xl:  2.441rem; /* 39px - H1 headings */
--text-4xl:  3.052rem; /* 49px - Hero text */
```

**Typography Combinations (The Recipe)**
```css
/* Hierarchy through size + weight + color */
.headline-1 { 
  font-size: var(--text-3xl); 
  font-weight: 700; 
  line-height: 1.2;
  letter-spacing: -0.02em;  /* Tighten large text */
  color: var(--gray-900);
}

.headline-2 { 
  font-size: var(--text-2xl); 
  font-weight: 600; 
  line-height: 1.3;
  letter-spacing: -0.01em;
  color: var(--gray-900);
}

.headline-3 { 
  font-size: var(--text-xl);  
  font-weight: 600; 
  line-height: 1.4;
  color: var(--gray-800);
}

.body-large { 
  font-size: var(--text-lg);  
  font-weight: 400; 
  line-height: 1.6;
  color: var(--gray-700);
}

.body { 
  font-size: var(--text-base); 
  font-weight: 400; 
  line-height: 1.5;
  color: var(--gray-700);
}

.body-small {
  font-size: var(--text-sm);
  font-weight: 400;
  line-height: 1.4;
  color: var(--gray-600);
}

.caption { 
  font-size: var(--text-sm);  
  font-weight: 400; 
  line-height: 1.4;
  color: var(--gray-500);
}

.overline { 
  font-size: var(--text-xs);  
  font-weight: 600; 
  letter-spacing: 0.05em; 
  text-transform: uppercase;
  color: var(--gray-600);
}

.code {
  font-family: var(--font-code);
  font-size: 0.875em;  /* Relative to parent */
  background: var(--gray-100);
  padding: 0.125em 0.25em;
  border-radius: 0.25em;
}
```

**Responsive Typography**
```css
/* Fluid typography with clamp() */
.headline-1 {
  font-size: clamp(2rem, 5vw, 3rem);  /* Min 32px, scales with viewport, max 48px */
}

/* OR breakpoint-based scaling */
@media (max-width: 768px) {
  :root {
    --text-base: 0.9375rem;  /* 15px on mobile */
  }
}
```

**Typography Rules**
1. **Never go below 14px** for body text (accessibility)
2. **Maintain 45-75 characters per line** for optimal reading
3. **Use tabular numbers** for data: `font-variant-numeric: tabular-nums`
4. **Increase line-height** for narrow columns (1.6-1.8)
5. **Decrease line-height** for large headings (1.1-1.2)

#### Spacing System

**Base Unit: 4px** (Follows Carbon/Polaris standard)

```css
--space-0:   0;
--space-1:   0.25rem;  /* 4px */
--space-2:   0.5rem;   /* 8px */
--space-3:   0.75rem;  /* 12px */
--space-4:   1rem;     /* 16px */
--space-5:   1.25rem;  /* 20px */
--space-6:   1.5rem;   /* 24px */
--space-8:   2rem;     /* 32px */
--space-10:  2.5rem;   /* 40px */
--space-12:  3rem;     /* 48px */
--space-16:  4rem;     /* 64px */
--space-20:  5rem;     /* 80px */
--space-24:  6rem;     /* 96px */
--space-32:  8rem;     /* 128px */
```

#### Depth & Shadows

**Elevation Levels** (Material-inspired but simplified):

```css
--shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.05);
--shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
--shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
```

**Usage mapping:**
- `shadow-xs`: Hover states, subtle separation
- `shadow-sm`: Cards, default elevation
- `shadow-md`: Dropdowns, popovers
- `shadow-lg`: Modals, important overlays
- `shadow-xl`: Temporary notifications

#### Border Radius Scale

```css
--radius-none: 0;
--radius-sm:   0.125rem; /* 2px - subtle */
--radius-md:   0.25rem;  /* 4px - default */
--radius-lg:   0.5rem;   /* 8px - cards */
--radius-xl:   0.75rem;  /* 12px - modals */
--radius-2xl:  1rem;     /* 16px - feature cards */
--radius-full: 9999px;   /* pills, avatars */
```

---

## Part 3: System Architecture

### Atomic Design + Every Layout Synthesis

#### Component Hierarchy

**Level 1: Atoms** (Indivisible elements)
```
Button, Input, Label, Icon, Badge, Avatar
```

**Level 2: Molecules** (Simple combinations)
```
FormField (Label + Input + Error)
Card (Container + Content)
ListItem (Icon + Text + Action)
```

**Level 3: Organisms** (Complex components)
```
NavigationBar (Logo + NavItems + UserMenu)
DataTable (Header + Rows + Pagination)
Form (Multiple FormFields + Actions)
```

**Level 4: Templates** (Page structures)
```
DashboardLayout (Sidebar + Header + Main)
AuthLayout (Centered card + Background)
```

**Level 5: Pages** (Templates + Content)
```
UserDashboard (DashboardLayout + specific widgets)
LoginPage (AuthLayout + login form)
```

### Layout Primitives (Every Layout)

#### The Stack
Vertical spacing with consistent rhythm:

```css
.stack > * + * {
  margin-block-start: var(--space, 1rem);
}

/* Usage */
<div class="stack" style="--space: 1.5rem;">
  <h2>Title</h2>
  <p>Paragraph</p>
  <button>Action</button>
</div>
```

#### The Cluster
Horizontal grouping with wrapping:

```css
.cluster {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space, 1rem);
  align-items: var(--align, center);
}
```

#### The Sidebar
Intrinsic responsive layout:

```css
.with-sidebar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space, 1rem);
}

.with-sidebar > :first-child {
  flex-basis: var(--sidebar-width, 20rem);
  flex-grow: 1;
}

.with-sidebar > :last-child {
  flex-basis: 0;
  flex-grow: 999;
  min-inline-size: var(--content-min, 50%);
}
```

#### The Grid
Auto-responsive without media queries:

```css
.auto-grid {
  display: grid;
  grid-template-columns: repeat(
    auto-fit,
    minmax(var(--min-column-width, 16rem), 1fr)
  );
  gap: var(--space, 1rem);
}
```

#### The Center
Content centering with max-width:

```css
.center {
  box-sizing: content-box;
  margin-inline: auto;
  max-inline-size: var(--max-width, 60ch);
  padding-inline: var(--padding, 1rem);
}
```

---

## Part 4: Design Tokens & Scales

### Comprehensive Token System

#### Color Tokens (Radix-inspired 12-step scales)

```css
/* Semantic color mapping */
--color-background:     var(--gray-50);
--color-surface:        white;
--color-surface-hover:  var(--gray-50);
--color-border:         var(--gray-200);
--color-border-hover:   var(--gray-300);
--color-text:           var(--gray-900);
--color-text-secondary: var(--gray-600);
--color-text-tertiary:  var(--gray-500);
--color-text-disabled:  var(--gray-400);

/* Interactive colors */
--color-primary:        var(--blue-600);
--color-primary-hover:  var(--blue-700);
--color-primary-text:   white;

/* Status colors */
--color-success:        var(--green-600);
--color-warning:        var(--yellow-500);
--color-error:          var(--red-600);
--color-info:           var(--blue-500);
```

#### Dark Mode Tokens

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-background:     var(--gray-900);
    --color-surface:        var(--gray-800);
    --color-surface-hover:  var(--gray-700);
    --color-border:         var(--gray-700);
    --color-border-hover:   var(--gray-600);
    --color-text:           var(--gray-50);
    --color-text-secondary: var(--gray-300);
    --color-text-tertiary:  var(--gray-400);
    --color-text-disabled:  var(--gray-500);
  }
}
```

#### Motion Tokens

```css
/* Durations */
--duration-instant: 0ms;
--duration-fast:    150ms;
--duration-normal:  300ms;
--duration-slow:    500ms;

/* Easings */
--ease-in:     cubic-bezier(0.4, 0, 1, 1);
--ease-out:    cubic-bezier(0, 0, 0.2, 1);
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
--ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);

/* Standard transitions */
--transition-colors: color, background-color, border-color;
--transition-opacity: opacity;
--transition-transform: transform;
--transition-all: all;

.interactive {
  transition-property: var(--transition-colors);
  transition-duration: var(--duration-fast);
  transition-timing-function: var(--ease-out);
}
```

#### Breakpoint Tokens

```css
--screen-sm: 640px;   /* Mobile landscape */
--screen-md: 768px;   /* Tablet portrait */
--screen-lg: 1024px;  /* Tablet landscape */
--screen-xl: 1280px;  /* Desktop */
--screen-2xl: 1536px; /* Wide desktop */

/* Container widths */
--container-sm: 640px;
--container-md: 768px;
--container-lg: 1024px;
--container-xl: 1280px;
```

#### Z-Index Scale

```css
--z-base:        0;
--z-dropdown:    1000;
--z-sticky:      1100;
--z-overlay:     1200;
--z-modal:       1300;
--z-popover:     1400;
--z-tooltip:     1500;
--z-notification: 1600;
```

---

## Part 5: Implementation Patterns

### Common UI Patterns (from Designing Interfaces)

#### Forms & Input

**Pattern: Inline Validation**
```jsx
const FormField = ({ label, error, ...props }) => (
  <div className="form-field">
    <label>{label}</label>
    <input 
      aria-invalid={!!error}
      aria-describedby={error ? `${props.id}-error` : undefined}
      {...props}
    />
    {error && (
      <span id={`${props.id}-error`} role="alert" className="error">
        {error}
      </span>
    )}
  </div>
);
```

**Pattern: Progressive Form**
```jsx
// Show additional fields based on previous answers
const ProgressiveForm = () => {
  const [type, setType] = useState('');
  
  return (
    <form>
      <RadioGroup value={type} onChange={setType}>
        <Radio value="individual">Individual</Radio>
        <Radio value="business">Business</Radio>
      </RadioGroup>
      
      {type === 'business' && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
          <Input label="Company Name" />
          <Input label="Tax ID" />
        </motion.div>
      )}
    </form>
  );
};
```

#### Navigation Patterns

**Pattern: Breadcrumb Trail**
```jsx
const Breadcrumbs = ({ items }) => (
  <nav aria-label="Breadcrumb">
    <ol className="breadcrumbs">
      {items.map((item, index) => (
        <li key={item.href}>
          {index < items.length - 1 ? (
            <Link href={item.href}>{item.label}</Link>
          ) : (
            <span aria-current="page">{item.label}</span>
          )}
        </li>
      ))}
    </ol>
  </nav>
);
```

#### Data Display

**Pattern: Skeleton Loading**
```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--gray-200) 25%,
    var(--gray-100) 50%,
    var(--gray-200) 75%
  );
  background-size: 200% 100%;
  animation: loading 1.5s infinite;
}

@keyframes loading {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

**Pattern: Empty States**
```jsx
const EmptyState = ({ title, description, action }) => (
  <div className="empty-state">
    <Icon name="inbox" size={48} />
    <h3>{title}</h3>
    <p>{description}</p>
    {action && (
      <Button variant="primary" className="mt-4">
        {action.label}
      </Button>
    )}
  </div>
);
```

### State Management

Every interactive element needs these states designed:

```css
/* Base state */
.button {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

/* Hover */
.button:hover:not(:disabled) {
  background: var(--color-surface-hover);
  border-color: var(--color-border-hover);
}

/* Focus (keyboard navigation) */
.button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* Active (being clicked) */
.button:active:not(:disabled) {
  transform: translateY(1px);
}

/* Disabled */
.button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Loading */
.button[data-loading="true"] {
  position: relative;
  color: transparent;
}

.button[data-loading="true"]::after {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  margin: auto;
  border: 2px solid transparent;
  border-radius: 50%;
  border-top-color: currentColor;
  animation: spin 0.6s linear infinite;
}
```

### Accessibility Patterns

**Focus Management**
```jsx
// Trap focus within modal
const useFocusTrap = (ref) => {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    
    const focusableElements = element.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    
    const handleTabKey = (e) => {
      if (e.key !== 'Tab') return;
      
      if (e.shiftKey && document.activeElement === firstElement) {
        lastElement.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        firstElement.focus();
        e.preventDefault();
      }
    };
    
    element.addEventListener('keydown', handleTabKey);
    firstElement?.focus();
    
    return () => element.removeEventListener('keydown', handleTabKey);
  }, [ref]);
};
```

**Screen Reader Announcements**
```jsx
// Live region for dynamic updates
const Announcer = () => (
  <div
    role="status"
    aria-live="polite"
    aria-atomic="true"
    className="sr-only"
    id="announcer"
  />
);

// Usage
const announce = (message) => {
  const announcer = document.getElementById('announcer');
  announcer.textContent = message;
};
```

---

## Part 6: Governance & Evolution

### Dan Mall's Pilot-First Approach

#### Phase 1: Pilot (Week 1-2)
Start with a single, high-impact feature:
1. Build the minimum viable pattern set
2. Document as you build
3. Test with real users
4. Measure speed improvement

**Success Metrics:**
- 50% reduction in design/dev time
- Consistent experience across the feature
- No accessibility regressions

#### Phase 2: Expand (Week 3-8)
1. Identify next 3-5 features to systematize
2. Extract common patterns from pilot
3. Build only what's needed (YAGNI principle)
4. Create contribution guidelines

#### Phase 3: Mature (Ongoing)
1. Version control with semantic versioning
2. Deprecation warnings (minimum 2 version notice)
3. Migration guides for breaking changes
4. Regular audits for unused components

### Documentation Standards

#### Component Documentation Template
```markdown
# Component Name

## Purpose
One sentence describing when to use this component.

## Anatomy
[Visual diagram of component parts]

## Usage
\```jsx
<Component prop="value" />
\```

## Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| ... | ... | ... | ... |

## Accessibility
- Keyboard behavior
- Screen reader behavior
- ARIA attributes

## States
- Default
- Hover
- Focus
- Active
- Disabled
- Loading
- Error

## Examples
[Interactive examples]

## Related
- Similar components
- Composable patterns
```

### Version Control Strategy

```json
{
  "version": "1.2.3",
  "releases": {
    "1.2.3": {
      "date": "2024-01-15",
      "changes": {
        "added": ["New ColorPicker component"],
        "fixed": ["Button focus ring in Safari"],
        "deprecated": ["Card.Header - use Card.Title instead"],
        "breaking": []
      }
    }
  }
}
```

### Team Workflows

**Design → Development Handoff**
1. Designer creates in grayscale first
2. Apply semantic color tokens
3. Annotate with token names, not values
4. Developer implements using exact tokens

**Contribution Process**
1. Propose pattern in GitHub discussion
2. Build prototype in isolation
3. Test accessibility with automated tools
4. Document all props and states
5. Submit PR with visual regression tests

---

## Part 7: Performance & Modern Considerations

### Performance Budget

**Core Web Vitals Targets:**
- **LCP** (Largest Contentful Paint): < 2.5s
- **FID** (First Input Delay): < 100ms
- **CLS** (Cumulative Layout Shift): < 0.1

**Implementation Rules:**
```css
/* Prevent layout shift */
img, video, iframe {
  aspect-ratio: 16 / 9; /* Set explicit aspect ratios */
  width: 100%;
  height: auto;
}

/* Font loading strategy */
@font-face {
  font-family: 'System';
  font-display: swap; /* Show fallback immediately */
}

/* Critical CSS inline */
/* Above-the-fold styles in <style> tag */
/* Rest loaded asynchronously */
```

### Animation Performance

```css
/* Only animate transform and opacity (GPU-accelerated) */
.smooth {
  will-change: transform; /* Hint to browser */
  transform: translateZ(0); /* Force GPU layer */
}

/* Reduce motion for accessibility */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Modern Patterns

#### AI/LLM Interfaces

**Pattern: Streaming Response**
```jsx
const StreamingMessage = ({ content, isStreaming }) => (
  <div className="message">
    <div className="content">
      {content}
      {isStreaming && <span className="cursor-blink" />}
    </div>
  </div>
);
```

**Pattern: Suggested Actions**
```jsx
const SuggestedActions = ({ actions, onSelect }) => (
  <div className="cluster" style={{ '--space': '0.5rem' }}>
    {actions.map(action => (
      <button
        key={action.id}
        className="chip"
        onClick={() => onSelect(action)}
      >
        {action.label}
      </button>
    ))}
  </div>
);
```

#### Data Visualization

**Color Scales for Charts**
```css
/* Sequential (single hue, increasing intensity) */
--chart-seq-1: hsl(209, 100%, 90%);
--chart-seq-2: hsl(209, 100%, 80%);
--chart-seq-3: hsl(209, 100%, 65%);
--chart-seq-4: hsl(209, 100%, 50%);
--chart-seq-5: hsl(209, 100%, 35%);

/* Diverging (two hues from center) */
--chart-div-1: hsl(15, 100%, 50%);  /* Red */
--chart-div-2: hsl(15, 60%, 70%);
--chart-div-3: hsl(0, 0%, 90%);     /* Gray center */
--chart-div-4: hsl(209, 60%, 70%);
--chart-div-5: hsl(209, 100%, 50%); /* Blue */

/* Categorical (distinct hues) */
--chart-cat-1: hsl(209, 100%, 50%); /* Blue */
--chart-cat-2: hsl(142, 71%, 45%);  /* Green */
--chart-cat-3: hsl(36, 100%, 50%);  /* Orange */
--chart-cat-4: hsl(291, 64%, 50%);  /* Purple */
--chart-cat-5: hsl(347, 86%, 50%);  /* Pink */
```

### Container Queries (Modern Responsive)

```css
/* Component-level responsive design */
.card-container {
  container-type: inline-size;
}

.card {
  display: grid;
  gap: 1rem;
}

/* Respond to container, not viewport */
@container (min-width: 400px) {
  .card {
    grid-template-columns: auto 1fr;
  }
}

@container (min-width: 600px) {
  .card {
    grid-template-columns: 200px 1fr auto;
  }
}
```

---

## Quick Reference

### Decision Tree: Spacing

```
Need spacing?
├─ Between siblings?
│  ├─ Vertically? → Stack primitive
│  └─ Horizontally? → Cluster primitive
├─ Around content?
│  ├─ Equal all sides? → padding: var(--space-4)
│  └─ Contextual? → padding-block/inline
└─ Between sections? → margin-block: var(--space-8 to 16)
```

### Decision Tree: Color

```
Need color?
├─ Interactive element?
│  ├─ Primary action? → var(--color-primary)
│  ├─ Destructive? → var(--color-error)
│  └─ Secondary? → var(--color-text) + border
├─ Status indicator?
│  ├─ Success? → var(--color-success)
│  ├─ Warning? → var(--color-warning)
│  ├─ Error? → var(--color-error)
│  └─ Info? → var(--color-info)
└─ Content?
   ├─ Primary text? → var(--color-text)
   ├─ Secondary? → var(--color-text-secondary)
   └─ Disabled? → var(--color-text-disabled)
```

### Component Checklist

- [ ] Accessible name (aria-label or visible label)
- [ ] Keyboard navigable (tabindex if needed)
- [ ] Focus visible state
- [ ] Touch target ≥ 44×44px (mobile) / 32×32px (desktop)
- [ ] Error state designed
- [ ] Loading state designed
- [ ] Empty state designed
- [ ] Responsive behavior defined
- [ ] Dark mode tokens applied
- [ ] Motion respects prefers-reduced-motion
- [ ] Documented with examples

---

## Resources & References

### Primary Sources
- [Refactoring UI](https://refactoringui.com) - Visual design for developers
- [Atomic Design](https://atomicdesign.bradfrost.com) - Component architecture
- [Laws of UX](https://lawsofux.com) - Psychology principles
- [Every Layout](https://every-layout.dev) - CSS layout primitives
- [USWDS](https://designsystem.digital.gov) - Accessibility patterns

### Design Systems
- [Shopify Polaris](https://polaris.shopify.com)
- [IBM Carbon](https://carbondesignsystem.com)
- [Atlassian Design System](https://atlassian.design)
- [Radix UI](https://radix-ui.com)

### Tools & Libraries
- [Tailwind CSS](https://tailwindcss.com) - Utility-first CSS
- [React Aria](https://react-spectrum.adobe.com/react-aria) - Accessible components
- [Radix Primitives](https://radix-ui.com/primitives) - Unstyled components

### Books & Articles
- "Don't Make Me Think" - Steve Krug
- "Designing Interfaces" - Jenifer Tidwell
- "Design Systems" - Alla Kholmatova
- Dan Mall's Design System articles

---

*This document is a living guide. Update it as patterns prove themselves in production.*