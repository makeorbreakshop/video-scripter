// Thumbnail-first grid of a channel's videos. A server component: sorting and paging are URL
// parameters, so the ORDER BY and the LIMIT happen in Postgres rather than in the browser.

import Link from 'next/link';
import type { GridVideo, SortKey } from '@/lib/app/channel-page';
import { GRID_PAGE, type RangeKey } from '@/lib/app/channel-page';
import { compact, etDate, ago } from '@/lib/admin/format';
import { Thumb } from './thumb';

const SORT_LABELS: [SortKey, string][] = [
  ['published', 'Newest'],
  ['score', 'Score'],
  ['views', 'Views'],
];

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

const RANGE_LABELS: [RangeKey, string][] = [['all', 'All time'], ['1y', 'Past year'], ['90d', '90 days'], ['30d', '30 days']];

export function FilterBar({ channelId, sort, range, showing, total }: { channelId: string; sort: SortKey; range: RangeKey; showing: number; total: number }) {
  const href = (s: SortKey, r: RangeKey) => `/app/channels/${channelId}?sort=${s}${r !== 'all' ? `&range=${r}` : ''}`;
  return (
    <div className="vg-bar">
      <div className="cs-chips" style={{ marginBottom: 0 }}>
        {SORT_LABELS.map(([key, label]) => (
          <Link key={key} href={href(key, range)} className="cs-chip" data-on={sort === key} aria-current={sort === key ? 'true' : undefined}>{label}</Link>
        ))}
      </div>
      <div className="cs-chips" style={{ marginBottom: 0 }}>
        {RANGE_LABELS.map(([key, label]) => (
          <Link key={key} href={href(sort, key)} className="cs-chip" data-on={range === key} aria-current={range === key ? 'true' : undefined}>{label}</Link>
        ))}
      </div>
      <span className="vg-meta" style={{ marginLeft: 'auto' }}>showing <span className="cs-num">{showing}</span> of <span className="cs-num">{total}</span></span>
    </div>
  );
}

function Packaging({ v }: { v: GridVideo }) {
  if (!v.swaps) return null;
  const label = `${v.swaps} swap${v.swaps === 1 ? '' : 's'}${v.last_change ? ` · ${ago(v.last_change)}` : ''}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span className="vg-meta" style={{ color: 'var(--cs-warn)', flex: 'none' }}>{label}</span>
      {v.prevThumbUrl ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, flex: 'none' }} title="previous → current thumbnail">
          <Thumb src={v.prevThumbUrl} alt="previous thumbnail" style={{ width: 34, opacity: 0.65 }} />
          <span aria-hidden className="cs-arrow" style={{ fontSize: 10 }}>→</span>
          <Thumb src={v.thumbUrl} alt="current thumbnail" style={{ width: 34 }} />
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
      .vg-grid { display: grid; grid-template-columns: 1fr; gap: 24px 18px; list-style: none; margin: 0; padding: 0; }
      @media (min-width: 640px) { .vg-grid { grid-template-columns: repeat(2, 1fr); } }
      @media (min-width: 1100px) { .vg-grid { grid-template-columns: repeat(3, 1fr); } }
      .vg-tile { min-width: 0; }
      .vg-tile img { border-radius: var(--cs-radius); }
      .vg-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 4px 0 18px; }
      .vg-title { font-size: 14px; font-weight: 550; line-height: 1.35; margin: 10px 0 0;
                  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .vg-tile:hover .vg-title { color: var(--cs-accent); }
      .vg-meta { font-size: 11px; color: var(--cs-muted); }
      .vg-clip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
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
            <Thumb src={v.thumbUrl} fallbackSrc={`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`} alt="" style={{ width: '100%' }} />
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

export function LoadMore({ channelId, sort, n, range = 'all' }: { channelId: string; sort: SortKey; n: number; range?: RangeKey }) {
  return (
    <div className="cs-center">
      <Link href={`/app/channels/${channelId}?sort=${sort}${range !== 'all' ? `&range=${range}` : ''}&n=${n + GRID_PAGE}`} className="cs-btn">
        Load more
      </Link>
    </div>
  );
}
