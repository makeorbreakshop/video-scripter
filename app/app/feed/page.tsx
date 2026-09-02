// /app/feed — the event stream for everything the user tracks. The first page is read
// straight from Postgres so the feed paints without a client round trip; scrolling
// pages through /api/app/feed.
import { redirect } from 'next/navigation';
import { q } from '@/lib/admin/db';
import { requireAppUser } from '@/lib/app/session';
import { feedFor } from '@/lib/feed/query';
import { avatarsFor } from '@/lib/app/channel-meta';
import FeedClient from '../_components/feed-client';

export const dynamic = 'force-dynamic';

export default async function FeedPage() {
  const user = await requireAppUser();
  if (!user) redirect('/sign-in');

  const tracked = await q<{ channel_id: string }>('select channel_id from user_channels where user_id = $1', [user.id]);
  const hasChannels = tracked.length > 0;
  // A user with nothing tracked has nowhere to start; onboarding is that starting point.
  if (!hasChannels) redirect('/app/onboarding');

  const [page, avatars] = await Promise.all([
    feedFor(user.id, { limit: 25 }),
    avatarsFor(tracked.map((t) => t.channel_id)),
  ]);

  return (
    <>
      <div className="cs-page-head">
        <div>
          <h1 className="cs-h1">Feed</h1>
          <p className="cs-sub">Every upload, packaging change and outlier across the channels you track.</p>
        </div>
      </div>
      <FeedClient initialEvents={page.events as any} initialCursor={page.next_cursor} hasChannels={hasChannels} avatars={avatars} />
    </>
  );
}
