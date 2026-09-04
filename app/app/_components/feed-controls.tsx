'use client';

// The feed's whole control surface: a chips row for what to show and a Sort menu for whose.
// Both are URL parameters, so a filtered feed is a link and the first page still renders on
// the server. The chips stay links — the server keeps doing the filtering.
//
// The Sort menu holds groups and channels in one flat list: a group row carries its colour
// dot and its member count, a channel row is bare. A native select could hold neither, and
// its optgroups render as OS chrome that ignores every token in theme.css.
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Chips, groupColor } from '@/components/app/chips';
import { Sort, type SortOption } from '@/components/app/menu';
import { FEED_SEGMENTS, type FeedSegment } from '@/lib/app/feed-format';

export function FeedControls({ segment, channelId, channels, groups = [] }: {
  segment: FeedSegment;
  /** A channel id, or "group:<id>". */
  channelId: string | null;
  channels: Array<{ id: string; name: string }>;
  groups?: Array<{ id: string; name: string; count: number; color?: string | null }>;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const href = (seg: FeedSegment) => {
    const p = new URLSearchParams(params?.toString() ?? '');
    if (seg === 'all') p.delete('seg'); else p.set('seg', seg);
    const s = p.toString();
    return `/app/feed${s ? `?${s}` : ''}`;
  };

  const options: SortOption[] = [
    { key: 'all', label: 'All channels' },
    ...groups.map((g) => ({
      key: `group:${g.id}`, label: g.name, color: groupColor(g.color), count: g.count,
    })),
    ...channels.map((c) => ({ key: c.id, label: c.name })),
  ];

  return (
    <div className="cs-controls">
      <Chips
        ariaLabel="Filter the feed"
        value={segment}
        items={FEED_SEGMENTS.map((s) => ({ key: s.key, label: s.label, href: href(s.key) }))}
        renderLink={(chip, props) => (
          <Link href={chip.href!} className={props.className} data-on={props['data-on']}
                aria-current={props['data-on'] ? 'true' : undefined}>{props.children}</Link>
        )}
      />
      <Sort
        ariaLabel="Channel"
        value={channelId ?? 'all'}
        options={options}
        onChange={(key) => {
          const p = new URLSearchParams(params?.toString() ?? '');
          if (key && key !== 'all') p.set('channel', key); else p.delete('channel');
          const s = p.toString();
          router.push(`/app/feed${s ? `?${s}` : ''}`);
        }}
      />
    </div>
  );
}
