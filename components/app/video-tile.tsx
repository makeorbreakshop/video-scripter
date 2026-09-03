// One video in the channel grid. Its own file because two places render it: the server grid
// in video-grid.tsx and the client "Load more" appender, which cannot import video-grid.tsx
// (that module reaches lib/app/channel-page.ts, and so Postgres, through its constants).
// Only types and pure formatters cross this boundary.

import Link from 'next/link';
import type { GridVideo, SortKey } from '@/lib/app/channel-page';
import { compact, etDate, ago } from '@/lib/admin/format';
import { Thumb } from './thumb';

export type { GridVideo, SortKey };

/** Score as plain text: accent and bold at 2x and up, muted otherwise, a dash when unscored. */
export function ScoreChip({ score, size = 'sm' }: { score: number | null; size?: 'sm' | 'lg' }) {
  const fontSize = size === 'lg' ? 16 : 12;
  if (score == null) return <span className="cs-num" title="not enough data to score this video yet" style={{ fontSize, color: 'var(--cs-muted)' }}>–</span>;
  const outlier = score >= 2;
  const color = outlier ? 'var(--cs-accent)' : score < 1 ? 'var(--cs-warn)' : 'var(--cs-ink)';
  return (
    <span className="cs-num" title={`${score.toFixed(2)}× the channel's baseline${score < 1 ? ' (below its usual)' : ''}`}
      style={{ fontSize, fontWeight: outlier ? 700 : 600, color }}>
      {score.toFixed(1)}×
    </span>
  );
}

// The before/after swatches are decoration for a row the reader may never scroll to, and the
// R2 worker cannot resize, so they keep the full-size URL but are always lazy and declare the
// 136x76 box they are actually painted into rather than hqdefault's 480x270.
const SWATCH = { width: 136, height: 76 };

function Packaging({ v }: { v: GridVideo }) {
  if (!v.swaps) return null;
  const label = `${v.swaps} swap${v.swaps === 1 ? '' : 's'}${v.last_change ? ` · ${ago(v.last_change)}` : ''}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span className="vg-meta" style={{ color: 'var(--cs-warn)', flex: 'none' }}>{label}</span>
      {v.prevThumbUrl ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, flex: 'none' }} title="previous → current thumbnail">
          <Thumb src={v.prevThumbUrl} alt="previous thumbnail" loading="lazy" {...SWATCH} style={{ width: 34, opacity: 0.65 }} />
          <span aria-hidden className="cs-arrow" style={{ fontSize: 10 }}>→</span>
          <Thumb src={v.thumbUrl} alt="current thumbnail" loading="lazy" {...SWATCH} style={{ width: 34 }} />
        </span>
      ) : v.title_prev ? (
        <span className="vg-meta vg-clip" title={`${v.title_prev} → ${v.title_latest}`}>title rewritten</span>
      ) : null}
    </div>
  );
}

/** `priority` is for the tiles above the fold — the first row or two, never the whole page. */
export function VideoTile({ v, priority = false }: { v: GridVideo; priority?: boolean }) {
  return (
    <li className="vg-tile">
      <Link href={`/app/videos/${v.id}`}>
        <Thumb
          src={v.thumbUrl}
          fallbackSrc={`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          style={{ width: '100%' }}
        />
        <h3 className="vg-title">{v.title}</h3>
      </Link>
      <div className="vg-foot">
        <span className="vg-meta vg-clip">
          {etDate(v.published_at)} · <span className="cs-num">{compact(v.view_count)}</span> views
        </span>
        <ScoreChip score={v.score} />
      </div>
      <div style={{ marginTop: 6 }}>
        <Packaging v={v} />
      </div>
    </li>
  );
}
