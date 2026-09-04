'use client';

// "Build for" on the Inspiration page. A Sort menu rather than a form field: picking a channel
// is a whole new search, so it navigates on the spot instead of waiting for Explore. The form
// still carries the channel in a hidden input so submitting the distance keeps the target.
import { useRouter } from 'next/navigation';
import { Sort } from '@/components/app/menu';

export function InspirationTarget({ targets, value, distance }: {
  targets: Array<{ channelId: string; name: string; role: string }>;
  value: string;
  distance: string;
}) {
  const router = useRouter();
  return (
    <Sort
      ariaLabel="Build for"
      align="start"
      value={value}
      options={targets.map((t) => ({
        key: t.channelId,
        label: `${t.name}${t.role === 'self' ? ' — your channel' : ''}`,
      }))}
      onChange={(key) => router.push(`/app/inspiration?channel=${encodeURIComponent(key)}&distance=${encodeURIComponent(distance)}`)}
    />
  );
}
