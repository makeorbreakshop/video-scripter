// Instant shell for /app/videos/[id]. Mirrors page.tsx: the 200px thumb beside the
// channel link / title / meta line, the big verdict number with its sentence, then the
// 320px-tall chart plate — the chart is the tall element, so reserving it is what keeps
// the page from jumping when the curve arrives.
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <style>{`
        .sk { background-color: var(--cs-surface-2);
              background-image: linear-gradient(90deg, var(--cs-surface-2) 25%, var(--cs-line) 50%, var(--cs-surface-2) 75%);
              background-size: 400% 100%; animation: cs-shimmer 1.3s infinite; }
        @media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
        .skv-head { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
        .skv-th { width: 200px; flex: none; }
        .skv-verdict { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
        .skv-big { width: 128px; height: 44px; }
        @media (max-width: 719px) {
          .skv-head { flex-direction: column; gap: 12px; }
          .skv-th { width: 100%; max-width: 320px; }
          .skv-big { width: 96px; height: 32px; }
        }
      `}</style>

      <div className="skv-head">
        <div className="skv-th">
          <div className="sk" style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 'var(--cs-radius)' }} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="sk" style={{ width: 130, height: 12, borderRadius: 4 }} />
          <div className="sk" style={{ width: '80%', height: 20, borderRadius: 5, marginTop: 8 }} />
          <div className="sk" style={{ width: '60%', height: 13, borderRadius: 4, marginTop: 8 }} />
        </div>
      </div>

      <div className="skv-verdict">
        <div className="sk skv-big" style={{ borderRadius: 6 }} />
        <div style={{ flex: 1, minWidth: 200, maxWidth: '60ch' }}>
          <div className="sk" style={{ width: '100%', height: 14, borderRadius: 4 }} />
          <div className="sk" style={{ width: '70%', height: 14, borderRadius: 4, marginTop: 6 }} />
        </div>
      </div>

      <section className="cs-section" style={{ marginTop: 18 }}>
        <div className="sk" style={{ width: '100%', height: 320, borderRadius: 'var(--cs-radius)' }} />
      </section>
    </div>
  );
}
