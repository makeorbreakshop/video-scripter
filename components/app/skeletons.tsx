// Shared loading shells. The route-level loading.tsx files and the in-page <Suspense>
// fallbacks render the SAME markup, so a navigation and a streamed boundary paint an
// identical placeholder and nothing moves when the real content lands.

/** The shimmer rule every skeleton block uses. Rendered once per shell. */
export function SkeletonStyles() {
  return (
    <style>{`
      .sk { background-color: var(--cs-surface-2);
            background-image: linear-gradient(90deg, var(--cs-surface-2) 25%, var(--cs-line) 50%, var(--cs-surface-2) 75%);
            background-size: 400% 100%; animation: cs-shimmer 1.3s infinite; }
      @media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
      .skc-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 4px 0 18px; }
      .skc-grid { display: grid; grid-template-columns: 1fr; gap: 24px 18px; }
      @media (min-width: 640px) { .skc-grid { grid-template-columns: repeat(2, 1fr); } }
      @media (min-width: 1100px) { .skc-grid { grid-template-columns: repeat(3, 1fr); } }
      .skc-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
    `}</style>
  );
}

/**
 * Filter bar + three-across 16:9 tile grid, matching components/app/video-grid.tsx at the
 * same sizes. Used by /app/channels/[id]/loading.tsx and by the page's own Suspense
 * boundary around the grid.
 */
export function GridSkeleton({ tiles = 9 }: { tiles?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <SkeletonStyles />

      <div className="skc-bar">
        {[62, 54, 56].map((w, i) => <div key={`s${i}`} className="sk" style={{ width: w, height: 27, borderRadius: 999 }} />)}
        <div style={{ width: 8 }} />
        {[70, 76, 68, 68].map((w, i) => <div key={`r${i}`} className="sk" style={{ width: w, height: 27, borderRadius: 999 }} />)}
        <div className="sk" style={{ width: 96, height: 11, borderRadius: 4, marginLeft: 'auto' }} />
      </div>

      <div className="skc-grid">
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i} style={{ minWidth: 0 }}>
            <div className="sk" style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 'var(--cs-radius)' }} />
            <div className="sk" style={{ width: '100%', height: 14, borderRadius: 4, marginTop: 12 }} />
            <div className="sk" style={{ width: '62%', height: 14, borderRadius: 4, marginTop: 5 }} />
            <div className="skc-foot">
              <div className="sk" style={{ width: 130, height: 11, borderRadius: 4 }} />
              <div className="sk" style={{ width: 32, height: 12, borderRadius: 4 }} />
            </div>
            <div className="sk" style={{ width: 84, height: 11, borderRadius: 4, marginTop: 12 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The channel page's own head: avatar, title, sub-line, track button. */
export function ChannelHeadSkeleton() {
  return (
    <div aria-busy="true">
      <SkeletonStyles />
      <style>{`.skc-head { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin-bottom: 14px; }`}</style>
      <div className="skc-head">
        <div className="sk" style={{ width: 56, height: 56, borderRadius: '50%', flex: 'none' }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="sk" style={{ width: 220, maxWidth: '60%', height: 20, borderRadius: 5 }} />
          <div className="sk" style={{ width: 320, maxWidth: '80%', height: 13, borderRadius: 4, marginTop: 6 }} />
        </div>
        <div className="sk" style={{ width: 104, height: 31, borderRadius: 8, marginLeft: 'auto', flex: 'none' }} />
      </div>
    </div>
  );
}

/** The chart + packaging sections of /app/videos/[id]. */
export function VideoBodySkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <SkeletonStyles />
      <section className="cs-section" style={{ marginTop: 18 }}>
        <div className="sk" style={{ width: '100%', height: 300, borderRadius: 'var(--cs-radius)' }} />
      </section>
      <section className="cs-section">
        <div className="sk" style={{ width: 190, height: 16, borderRadius: 4 }} />
        <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="sk" style={{ width: 200, aspectRatio: '16 / 9', borderRadius: 'var(--cs-radius)' }} />
          ))}
        </div>
      </section>
    </div>
  );
}

/** Feed rows (mirrors app/app/feed/loading.tsx). */
export function FeedSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <SkeletonStyles />
      <div className="cs-chips">
        {[46, 74, 96, 88, 78].map((w, i) => (
          <div key={i} className="sk" style={{ width: w, height: 27, borderRadius: 999 }} />
        ))}
      </div>
      <div className="cs-feed">
        {Array.from({ length: rows }, (_, i) => (
          <div className="cs-row" key={i}>
            <div className="cs-thumbs"><div className="sk cs-thumb" /></div>
            <div className="cs-row-body">
              <div className="sk" style={{ width: 240, maxWidth: '70%', height: 13, borderRadius: 4, marginBottom: 8 }} />
              <div className="sk" style={{ width: '92%', height: 16, borderRadius: 4 }} />
              <div className="sk" style={{ width: '55%', height: 16, borderRadius: 4, marginTop: 5 }} />
              <div className="sk" style={{ width: 180, height: 13, borderRadius: 4, marginTop: 8 }} />
            </div>
            <div className="cs-row-right"><div className="sk" style={{ width: 56, height: 25, borderRadius: 6 }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The tracked-channel card grid on /app/channels. */
export function ChannelCardsSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <SkeletonStyles />
      <style>{`.skl-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px;
                             border-top: 1px solid var(--cs-line); padding-top: 10px; }`}</style>
      <div className="cs-grid">
        {Array.from({ length: cards }, (_, i) => (
          <div className="cs-card" key={i}>
            <div className="cs-card-head">
              <div className="sk" style={{ width: 96, aspectRatio: '16/9', borderRadius: 6, flex: 'none' }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="sk" style={{ width: '70%', height: 14, borderRadius: 4 }} />
                <div className="sk" style={{ width: 74, height: 16, borderRadius: 999, marginTop: 8 }} />
              </div>
            </div>
            <div className="skl-stats">
              {[0, 1, 2, 3].map((s) => (
                <div key={s}>
                  <div className="sk" style={{ width: 40, height: 14, borderRadius: 4 }} />
                  <div className="sk" style={{ width: 52, height: 10, borderRadius: 3, marginTop: 3 }} />
                </div>
              ))}
            </div>
            <div className="cs-card-foot">
              <div className="sk" style={{ width: 66, height: 31, borderRadius: 8 }} />
              <div className="sk" style={{ width: 74, height: 31, borderRadius: 8, marginLeft: 'auto' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
