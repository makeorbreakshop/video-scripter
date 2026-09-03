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

/**
 * "3 EDITS" on the tile: this video's packaging has moved since it was published. A count, not
 * a story — the story is the Changes tab and the video page's timeline. It replaced a row of
 * before/after swatches under every tile, which drew the same thumbnails twice at 34px.
 */
function EditsBadge({ v }: { v: GridVideo }) {
  if (!v.swaps) return null;
  const label = `${v.swaps} EDIT${v.swaps === 1 ? '' : 'S'}`;
  return <span className="vg-edits" title={v.last_change ? `last change ${ago(v.last_change)}` : undefined}>{label}</span>;
}

/** `priority` is for the tiles above the fold — the first row or two, never the whole page. */
export function VideoTile({ v, priority = false }: { v: GridVideo; priority?: boolean }) {
  return (
    <li className="vg-tile">
      <Link href={`/app/videos/${v.id}`}>
        <span style={{ position: 'relative', display: 'block' }}>
          <Thumb
            src={v.thumbUrl}
            fallbackSrc={`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`}
            alt=""
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : undefined}
            style={{ width: '100%' }}
          />
          <EditsBadge v={v} />
        </span>
        <h3 className="vg-title">{v.title}</h3>
      </Link>
      <div className="vg-foot">
        <span className="vg-meta vg-clip">
          {etDate(v.published_at)} · <span className="cs-num">{compact(v.view_count)}</span> views
        </span>
        <ScoreChip score={v.score} />
      </div>
    </li>
  );
}
