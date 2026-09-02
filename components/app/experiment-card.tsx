'use client';

// One packaging change, read as an experiment: how fast views were arriving before the swap
// versus after it. The verdict and its thresholds live in lib/app/experiment.ts — this only
// renders them, and stays in sync with the chart's hover.

import type { Experiment, Verdict } from '@/lib/app/experiment';
import { markerKey, useMarkerHover } from './video-chart';

const VERDICT: Record<Verdict, { label: string; color: string }> = {
  helped: { label: 'helped', color: 'var(--cs-good)' },
  hurt: { label: 'hurt', color: 'var(--cs-bad)' },
  'no clear effect': { label: 'no clear effect', color: 'var(--cs-muted)' },
  'too early': { label: 'too early to tell', color: 'var(--cs-warn)' },
};

function vph(v: number | null) {
  if (v == null) return '–';
  return v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v));
}

function Rate({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="cs-stat-l">{label}</div>
      <div className="cs-num" style={{ fontSize: 15 }}>
        {vph(value)}<span style={{ fontSize: 10, color: 'var(--cs-muted)' }}>/h</span>
      </div>
    </div>
  );
}

export function ExperimentCard({ e, thumbUrls }: { e: Experiment; thumbUrls: Record<number, string> }) {
  const { hovered, setHovered } = useMarkerHover();
  const key = markerKey(e);
  const on = hovered === key;
  const v = VERDICT[e.verdict];

  return (
    <li
      tabIndex={0}
      onMouseEnter={() => setHovered(key)}
      onMouseLeave={() => setHovered(null)}
      onFocus={() => setHovered(key)}
      onBlur={() => setHovered(null)}
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: 12, outline: 'none',
        borderRadius: 'var(--cs-radius)',
        border: `1px solid ${on ? 'var(--cs-accent)' : 'var(--cs-line)'}`,
        background: on ? 'var(--cs-surface-2)' : 'var(--cs-surface)',
      }}
    >
      <div style={{ width: 104, flex: 'none', fontSize: 11, color: 'var(--cs-muted)' }}>
        <div style={{ color: 'var(--cs-ink)', fontWeight: 600, fontSize: 12 }}>
          {e.kind === 'thumb' ? 'Thumbnail' : 'Title'} v{e.version}
        </div>
        {e.day < 1 ? `${Math.round(e.day * 24)}h in` : `day ${e.day.toFixed(1)}`}
      </div>

      {e.kind === 'thumb' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
          {[e.fromVersion, e.version].map((nv, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {i === 1 && <span aria-hidden className="cs-arrow">→</span>}
              <span className="cs-thumb" style={{ display: 'block', width: 96 }}>
                {nv != null && thumbUrls[nv] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbUrls[nv]} alt={`thumbnail v${nv}`} />
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ flex: 1, minWidth: 180, fontSize: 11 }}>
          <div style={{ color: 'var(--cs-muted)', textDecoration: 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.from}</div>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.to}</div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Rate label="before" value={e.beforeVph} />
        <span aria-hidden className="cs-arrow">→</span>
        <Rate label="after" value={e.afterVph} />
        {e.ratio != null && <div className="cs-num" style={{ color: 'var(--cs-muted)' }}>{e.ratio.toFixed(2)}×</div>}
      </div>

      <span
        className="cs-badge"
        style={{ marginLeft: 'auto', color: v.color, background: 'var(--cs-surface-2)', border: `1px solid ${v.color}` }}
      >
        {v.label}
      </span>

      <p style={{ width: '100%', margin: 0, fontSize: 11, color: 'var(--cs-muted)' }}>
        views per hour over {e.windowBeforeHours.toFixed(1)}h before ({e.beforeSamples} sample{e.beforeSamples === 1 ? '' : 's'})
        {' '}vs {e.windowAfterHours.toFixed(1)}h after ({e.afterSamples})
      </p>
    </li>
  );
}
