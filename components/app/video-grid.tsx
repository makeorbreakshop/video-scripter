// Thumbnail-first grid of a channel's videos. A server component: sorting and paging are URL
// parameters, so the ORDER BY and the LIMIT happen in Postgres rather than in the browser.

import Link from 'next/link';
import type { GridVideo, SortKey } from '@/lib/app/channel-page';
import { GRID_PAGE, type RangeKey } from '@/lib/app/channel-page';
import { ThumbFallbackScript } from './thumb';
import { VideoTile, ScoreChip } from './video-tile';
import { LoadMoreClient } from './load-more';

export { ScoreChip };

const SORT_LABELS: [SortKey, string][] = [
  ['published', 'Newest'],
  ['score', 'Score'],
  ['views', 'Views'],
];

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

/** The grid's own CSS: four across at 1440, two at 768, one at 390. */
export function VideoGridStyles() {
  return (
    <>
    <ThumbFallbackScript />
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
    </>
  );
}

// The first six tiles are the ones on screen before any scrolling at three across, so they
// load eagerly at high priority; the remaining fifty-four wait until the reader approaches
// them. Before this, ninety-six unsized images competed over six connections at once.
const EAGER_TILES = 6;

export function VideoGrid({ videos }: { videos: GridVideo[] }) {
  if (!videos.length) return <p className="vg-meta">No videos for this channel yet.</p>;
  return (
    <ul className="vg-grid">
      {videos.map((v, i) => <VideoTile key={v.id} v={v} priority={i < EAGER_TILES} />)}
    </ul>
  );
}

/** Kept as a server component with its old props; the fetching happens in the client half. */
export function LoadMore({ channelId, sort, n, range = 'all', maxRows = 480 }: { channelId: string; sort: SortKey; n: number; range?: RangeKey; maxRows?: number }) {
  return <LoadMoreClient channelId={channelId} sort={sort} range={range} initial={n} pageSize={GRID_PAGE} maxRows={maxRows} />;
}
