'use client';

// Inspiration's control line, built from the two controls the rest of the app already uses:
// a Sort for whose ideas, a chips row for how far out. It replaced a <form> carrying a
// bespoke 38px segmented radio, two uppercase eyebrow labels and an Explore submit button —
// a sixth control type, a sixth height and a sixth "selected" treatment, for a job the feed
// does with <Chips>. Both controls navigate on click, so a search is a link and the server
// keeps doing the work.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Chips } from '@/components/app/chips';
import { Sort } from '@/components/app/menu';
import type { InspirationDistance } from '@/lib/semantic/inspiration';

export const DISTANCES: Array<{ value: InspirationDistance; label: string }> = [
  { value: 'near', label: 'Near' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'far', label: 'Far' },
];

const href = (channelId: string, distance: string) =>
  `/app/inspiration?channel=${encodeURIComponent(channelId)}&distance=${encodeURIComponent(distance)}`;

export function InspirationControls({ targets, channelId, distance }: {
  targets: Array<{ channelId: string; name: string; role: string }>;
  channelId: string;
  distance: InspirationDistance;
}) {
  const router = useRouter();
  return (
    <div className="cs-controls cs-controls-lead">
      <Sort
        ariaLabel="Build for"
        align="start"
        value={channelId}
        options={targets.map((t) => ({
          key: t.channelId,
          label: `${t.name}${t.role === 'self' ? ' — your channel' : ''}`,
        }))}
        onChange={(key) => router.push(href(key, distance))}
      />
      <Chips
        ariaLabel="How far outside this channel's territory"
        value={distance}
        items={DISTANCES.map((d) => ({ key: d.value, label: d.label, href: href(channelId, d.value) }))}
        renderLink={(chip, props) => (
          <Link href={chip.href!} className={props.className} data-on={props['data-on']}
                aria-current={props['data-on'] ? 'true' : undefined}>{props.children}</Link>
        )}
      />
    </div>
  );
}
