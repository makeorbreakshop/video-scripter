// /app/channels — the user's tracked channels, plus the add-channel flow.
//
// The head and the add flow need only the plan usage and the ids already tracked (two small
// per-user reads), so they paint straight away; the card rows — listUserChannels, the heavy
// one — are handed down unawaited and stream into the client component's Suspense boundary.
// Both reads are per-user, so neither is cached.
import { redirect } from 'next/navigation';
import { listUserChannels } from '@/lib/app/channels';
import { planUsage } from '@/lib/app/users';
import { requireAppUser } from '@/lib/app/session';
import { q } from '@/lib/admin/db';
import ChannelsClient from '../../_components/channel-list';

export const dynamic = 'force-dynamic';

export default async function ChannelsPage() {
  const user = await requireAppUser();
  if (!user) redirect('/sign-in');

  const [usage, tracked] = await Promise.all([
    planUsage(user.id),
    q<{ channel_id: string }>('select channel_id from user_channels where user_id = $1', [user.id]),
  ]);
  // Deliberately not awaited: the client component suspends on it inside its own boundary.
  const channels = listUserChannels(user.id);

  return (
    <ChannelsClient
      channels={channels as any}
      trackedIds={tracked.map((t) => t.channel_id)}
      plan={usage.plan}
      limits={usage.limits}
      usage={{ tracked: usage.tracked, watched_closely: usage.watchedClosely }}
    />
  );
}
