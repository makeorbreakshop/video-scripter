'use client';

// The feed's whole control surface: one right-aligned row on the heading's line. It replaces
// two stacked rows of type chips — a segmented switch for what to show, a dropdown for whose.
// Both are URL parameters, so a filtered feed is a link and the first page still renders on
// the server.
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
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
      <div className="cs-seg" role="group" aria-label="Filter the feed">
        {FEED_SEGMENTS.map((s) => (
          <Link key={s.key} href={href(s.key)} data-on={segment === s.key}
                aria-current={segment === s.key ? 'true' : undefined}>{s.label}</Link>
        ))}
      </div>
      <select className="cs-select" aria-label="Channel" value={channelId ?? ''}
              onChange={(e) => {
                const p = new URLSearchParams(params?.toString() ?? '');
                if (e.target.value) p.set('channel', e.target.value); else p.delete('channel');
                const s = p.toString();
                router.push(`/app/feed${s ? `?${s}` : ''}`);
              }}>
        <option value="">All channels</option>
        {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  );
}
