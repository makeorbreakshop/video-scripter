// Thumbnail-first grid of a channel's videos. A server component: sorting and paging are URL
// parameters, so the ORDER BY and the LIMIT happen in Postgres rather than in the browser.

import Link from 'next/link';
import type { GridVideo, SortKey } from '@/lib/app/channel-page';
import { GRID_PAGE } from '@/lib/app/channel-page';
import { compact, etDate, ago } from '@/lib/admin/format';

const SORT_LABELS: [SortKey, string][] = [
  ['score', 'Score'],
  ['published', 'Newest'],
  ['views', 'Views'],
];

/**
 * Score in the pixel face, the one arcade note in the design. An outlier (>= 2x) gets the
 * accent frame and a larger numeral; an unscored video gets a muted dash, never a zero.
 */
export function ScoreChip({ score, size = 'sm' }: { score: number | null; size?: 'sm' | 'lg' }) {
  if (score == null) {
    return (
      <span
        className="cs-score"
        title="not enough data to score this video yet"
        style={{ background: 'var(--cs-surface-2)', color: 'var(--cs-muted)', borderColor: 'var(--cs-line)', fontSize: size === 'lg' ? 12 : 9 }}
      >
        –
      </span>
    );
  }
  const outlier = score >= 2;
  const fontSize = size === 'lg' ? (outlier ? 22 : 15) : outlier ? 12 : 9;
  return (
    <span
      className="cs-score"
      title={`${score.toFixed(2)}× the channel's baseline`}
      style={
        outlier
          ? { fontSize, padding: size === 'lg' ? '12px 14px 10px' : '7px 9px 6px' }
          : { fontSize, background: 'var(--cs-surface-2)', color: 'var(--cs-muted)', borderColor: 'var(--cs-line)' }
      }
    >
      {score.toFixed(1)}×
    </span>
  );
}

export function SortTabs({ channelId, sort, n }: { channelId: string; sort: SortKey; n: number }) {
  return (
    <div className="cs-chips" style={{ marginBottom: 0 }}>
      {SORT_LABELS.map(([key, label]) => (
        <Link
          key={key}
          href={`/app/channels/${channelId}?sort=${key}${n !== GRID_PAGE ? `&n=${n}` : ''}`}
          className="cs-chip"
          data-on={sort === key}
          aria-current={sort === key ? 'true' : undefined}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

function Packaging({ v }: { v: GridVideo }) {
  if (!v.swaps) return <span className="vg-meta">no swaps</span>;
  const label = `${v.swaps} swap${v.swaps === 1 ? '' : 's'}${v.last_change ? ` · ${ago(v.last_change)}` : ''}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span className="vg-meta" style={{ color: 'var(--cs-warn)', flex: 'none' }}>{label}</span>
      {v.prevThumbUrl ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, flex: 'none' }} title="previous → current thumbnail">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={v.prevThumbUrl} alt="previous thumbnail" className="vg-mini" style={{ opacity: 0.65 }} />
          <span aria-hidden className="cs-arrow" style={{ fontSize: 10 }}>→</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={v.thumbUrl} alt="current thumbnail" className="vg-mini" />
        </span>
      ) : v.title_prev ? (
        <span className="vg-meta vg-clip" title={`${v.title_prev} → ${v.title_latest}`}>title rewritten</span>
      ) : null}
    </div>
  );
}

/** The grid's own CSS: four across at 1440, two at 768, one at 390. */
export function VideoGridStyles() {
  return (
    <style>{`
      .vg-grid { display: grid; grid-template-columns: 1fr; gap: 14px; list-style: none; margin: 0; padding: 0; }
      @media (min-width: 640px) { .vg-grid { grid-template-columns: repeat(2, 1fr); } }
      @media (min-width: 1200px) { .vg-grid { grid-template-columns: repeat(4, 1fr); } }
      .vg-tile { border: 1px solid var(--cs-line); border-radius: var(--cs-radius);
                 background: var(--cs-surface); padding: 10px; min-width: 0; }
      .vg-tile:hover { border-color: var(--cs-line-strong); }
      .vg-tile img.vg-cover { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 6px;
                              display: block; background: var(--cs-surface-2); }
      .vg-title { font-size: 13px; font-weight: 550; line-height: 1.35; margin: 8px 0 0;
                  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .vg-tile:hover .vg-title { color: var(--cs-accent); }
      .vg-meta { font-size: 11px; color: var(--cs-muted); }
      .vg-clip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
      .vg-mini { width: 34px; aspect-ratio: 16/9; object-fit: cover; border-radius: 3px;
                 border: 1px solid var(--cs-line); display: block; }
      .vg-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
    `}</style>
  );
}

export function VideoGrid({ videos }: { videos: GridVideo[] }) {
  if (!videos.length) return <p className="vg-meta">No videos for this channel yet.</p>;
  return (
    <ul className="vg-grid">
      {videos.map((v) => (
        <li key={v.id} className="vg-tile">
          <Link href={`/app/videos/${v.id}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={v.thumbUrl} alt="" className="vg-cover" />
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
      ))}
    </ul>
  );
}

export function LoadMore({ channelId, sort, n }: { channelId: string; sort: SortKey; n: number }) {
  return (
    <div className="cs-center">
      <Link href={`/app/channels/${channelId}?sort=${sort}&n=${n + GRID_PAGE}`} className="cs-btn">
        Load more
      </Link>
    </div>
  );
}
