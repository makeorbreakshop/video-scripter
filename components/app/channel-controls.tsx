'use client';

// A channel page's controls: the Videos / Changes / Analytics tabs and, on the same line, one right-aligned
// row — a segmented switch and a dropdown. Everything is a URL parameter, so the server keeps
// doing the ORDER BY and the LIMIT and a filtered view is a link.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SortKey, RangeKey } from '@/lib/app/channel-page';
import type { ChangeKind } from '@/lib/app/packaging-rows';

const SORTS: Array<[SortKey, string]> = [['published', 'Newest'], ['score', 'Score'], ['views', 'Views']];
const RANGES: Array<[RangeKey, string]> = [['all', 'All time'], ['1y', 'Past year'], ['90d', '90 days'], ['30d', '30 days']];
const KINDS: Array<[ChangeKind, string]> = [['all', 'All'], ['thumbnails', 'Thumbnails'], ['titles', 'Titles'], ['outliers', 'Outliers']];

export type Tab = 'videos' | 'changes' | 'analytics';

function build(channelId: string, params: Record<string, string | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return `/app/channels/${channelId}${s ? `?${s}` : ''}`;
}

export function ChannelBar({
  channelId, tab, videoCount, changeCount, sort, range, kind, showing, total,
}: {
  channelId: string; tab: Tab;
  videoCount: number; changeCount: number;
  sort: SortKey; range: RangeKey; kind: ChangeKind;
  showing: number; total: number;
}) {
  const router = useRouter();
  const keep: Record<string, string | null> = tab === 'changes'
    ? { tab: 'changes', kind: kind === 'all' ? null : kind }
    : tab === 'analytics'
      ? { tab: 'analytics' }
      : { sort: sort === 'published' ? null : sort };

  return (
    <div className="cs-tabbar">
      <nav className="cs-tabs" aria-label="Channel views">
        <Link className="cs-tab" data-on={tab === 'videos'} aria-current={tab === 'videos' ? 'page' : undefined}
              href={build(channelId, { sort: sort === 'published' ? null : sort, range: range === 'all' ? null : range })}>
          Videos <span className="cs-num">{videoCount}</span>
        </Link>
        <Link className="cs-tab" data-on={tab === 'changes'} aria-current={tab === 'changes' ? 'page' : undefined}
              href={build(channelId, { tab: 'changes', range: range === 'all' ? null : range })}>
          Changes <span className="cs-num">{changeCount}</span>
        </Link>
        <Link className="cs-tab" data-on={tab === 'analytics'} aria-current={tab === 'analytics' ? 'page' : undefined}
              href={build(channelId, { tab: 'analytics', range: range === 'all' ? null : range })}>
          Analytics
        </Link>
      </nav>

      <div className="cs-controls">
        {/* Analytics plots whatever the range holds — there is no page, so there is nothing to
            be "showing N of M" of, and no second axis to sort. Only the range control fits. */}
        {tab !== 'analytics' && (
          <span className="cs-showing">showing <span className="cs-num">{showing}</span> of <span className="cs-num">{total}</span></span>
        )}
        {tab === 'analytics' ? null : tab === 'videos' ? (
          <div className="cs-seg" role="group" aria-label="Sort videos">
            {SORTS.map(([key, label]) => (
              <Link key={key} href={build(channelId, { sort: key === 'published' ? null : key, range: range === 'all' ? null : range })}
                    data-on={sort === key} aria-current={sort === key ? 'true' : undefined}>{label}</Link>
            ))}
          </div>
        ) : (
          <div className="cs-seg" role="group" aria-label="Filter changes">
            {KINDS.map(([key, label]) => (
              <Link key={key} href={build(channelId, { tab: 'changes', kind: key === 'all' ? null : key, range: range === 'all' ? null : range })}
                    data-on={kind === key} aria-current={kind === key ? 'true' : undefined}>{label}</Link>
            ))}
          </div>
        )}
        <select className="cs-select" aria-label="Published within" value={range}
                onChange={(e) => router.push(build(channelId, { ...keep, range: e.target.value === 'all' ? null : e.target.value }))}>
          {RANGES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
    </div>
  );
}
