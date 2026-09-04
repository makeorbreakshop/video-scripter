// /app/channels — the user's tracked channels, their groups, and the add-channel flow.
//
// The top row (import + the notify meter), the search box and the group chips need only the
// small per-user reads, so they paint straight away; the rows — listUserChannels plus the
// sparkline lane — are handed down unawaited and stream into the client component's Suspense
// boundary. The sparklines are cached per channel (lib/app/cached.ts); everything else here
// is per-user and deliberately not.
import { redirect } from 'next/navigation';
import { listUserChannels } from '@/lib/app/channels';
import { listGroups } from '@/lib/app/channel-groups';
import { cachedSparklines } from '@/lib/app/cached';
import { planUsage } from '@/lib/app/users';
import { requireAppUser } from '@/lib/app/session';
import { q } from '@/lib/admin/db';
import ChannelsClient from '../../_components/channel-list';

export const dynamic = 'force-dynamic';

export default async function ChannelsPage() {
  const user = await requireAppUser();
  if (!user) redirect('/sign-in');

  const [usage, tracked, groups] = await Promise.all([
    planUsage(user.id),
    q<{ channel_id: string; notify: boolean }>(
      'select channel_id, notify from user_channels where user_id = $1',
      [user.id]
    ),
    listGroups(user.id),
  ]);

  // Deliberately not awaited: the client component suspends on it inside its own boundary.
  // The sparkline read waits on the same list, so it is chained rather than raced.
  const channels = listUserChannels(user.id).then(async (rows) => {
    const sparks = await cachedSparklines(rows.map((r) => r.channel_id)).catch(() => ({}));
    return rows.map((r) => ({ ...r, spark: (sparks as any)[r.channel_id] ?? null }));
  });

  return (
    <ChannelsClient
      channels={channels as any}
      trackedIds={tracked.map((t) => t.channel_id)}
      groups={groups}
      plan={usage.plan}
      limits={usage.limits}
      usage={{ tracked: usage.tracked, watched_closely: usage.watchedClosely }}
      notifyCount={tracked.filter((t) => t.notify).length}
    />
  );
}
