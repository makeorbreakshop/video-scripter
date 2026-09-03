// /app/feed — the event stream for everything the user tracks. The first page is read
// straight from Postgres so the feed paints without a client round trip; scrolling
// pages through /api/app/feed.
//
// The head is rendered from the tracked-channel check alone; the feed query and the avatar
// lookup stream into a <Suspense> boundary behind the same skeleton the route's loading.tsx
// shows. The feed is per-user, so none of it is cached.
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { q } from '@/lib/admin/db';
import { requireAppUser } from '@/lib/app/session';
import { feedFor } from '@/lib/feed/query';
import { avatarsFor } from '@/lib/app/channel-meta';
import { FeedSkeleton } from '@/components/app/skeletons';
import FeedClient from '../_components/feed-client';

export const dynamic = 'force-dynamic';

async function FeedBody({ userId, channelIds }: { userId: string; channelIds: string[] }) {
  const [page, avatars] = await Promise.all([
    feedFor(userId, { limit: 60 }),
    avatarsFor(channelIds),
  ]);
  return <FeedClient initialEvents={page.events as any} initialCursor={page.next_cursor} hasChannels avatars={avatars} />;
}

export default async function FeedPage() {
  const user = await requireAppUser();
  if (!user) redirect('/sign-in');

  const tracked = await q<{ channel_id: string }>('select channel_id from user_channels where user_id = $1', [user.id]);
  // A user with nothing tracked has nowhere to start; onboarding is that starting point.
  if (!tracked.length) redirect('/app/onboarding');

  return (
    <>
      <div className="cs-page-head">
        <div>
          <h1 className="cs-h1">Feed</h1>
          <p className="cs-sub">Every upload, packaging change and outlier across the channels you track.</p>
        </div>
      </div>
      <Suspense fallback={<FeedSkeleton />}>
        <FeedBody userId={user.id} channelIds={tracked.map((t) => t.channel_id)} />
      </Suspense>
    </>
  );
}
