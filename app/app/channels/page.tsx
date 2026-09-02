// /app/channels — the user's tracked channels, plus the add-channel flow.
import { redirect } from 'next/navigation';
import { listUserChannels } from '@/lib/app/channels';
import { planUsage } from '@/lib/app/users';
import { requireAppUser } from '@/lib/app/session';
import ChannelsClient from '../_components/channels-client';

export const dynamic = 'force-dynamic';

export default async function ChannelsPage() {
  const user = await requireAppUser();
  if (!user) redirect('/sign-in');

  const [channels, usage] = await Promise.all([listUserChannels(user.id), planUsage(user.id)]);

  return (
    <ChannelsClient
      channels={channels as any}
      plan={usage.plan}
      limits={usage.limits}
      usage={{ tracked: usage.tracked, watched_closely: usage.watchedClosely }}
    />
  );
}
