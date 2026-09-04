'use client';

// The feed's whole control surface: a chips row for what to show and a Sort menu for whose.
// Both are URL parameters, so a filtered feed is a link and the first page still renders on
// the server. The chips stay links — the server keeps doing the filtering.
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Chips } from '@/components/app/chips';
import { Sort } from '@/components/app/menu';
import { FEED_SEGMENTS, type FeedSegment } from '@/lib/app/feed-format';

export function FeedControls({ segment, channelId, channels }: {
  segment: FeedSegment;
  channelId: string | null;
  channels: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const href = (seg: FeedSegment) => {
    const p = new URLSearchParams(params?.toString() ?? '');
    if (seg === 'all') p.delete('seg'); else p.set('seg', seg);
    const s = p.toString();
    return `/app/feed${s ? `?${s}` : ''}`;
  };

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
        options={[{ key: 'all', label: 'All channels' }, ...channels.map((c) => ({ key: c.id, label: c.name }))]}
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
