// /app/feed — the event stream for everything the user tracks. The first page is read
// straight from Postgres so the feed paints without a client round trip; scrolling
// pages through /api/app/feed.
//
// Filtering is URL state (`seg`, `channel`), so a filtered feed is a link and the server still
// renders the first page. The head — heading and the one control row on its line — is rendered
// from the tracked-channel check alone; the feed query, the packaging versions and the avatar
// lookup stream into a <Suspense> boundary behind the route's skeleton. The feed is per-user,
// so none of it is cached.
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { q } from '@/lib/admin/db';
import { requireAppUser } from '@/lib/app/session';
import { feedForChannels } from '@/lib/feed/query';
import { avatarsFor } from '@/lib/app/channel-meta';
import { parseSegment, segmentTypes, type FeedSegment } from '@/lib/app/feed-format';
import { packagingVideoIds, testRowsForEvents } from '@/lib/app/feed-tests';
import { thumbRowsFor } from '@/lib/app/packaging-rows';
import { FeedSkeleton } from '@/components/app/skeletons';
import FeedClient from '../_components/feed-client';
import { FeedControls } from '../_components/feed-controls';

export const dynamic = 'force-dynamic';

async function FeedBody({ channelIds, segment }: { channelIds: string[]; segment: FeedSegment }) {
  const [page, avatars] = await Promise.all([
    feedForChannels(channelIds, { limit: 60, types: segmentTypes(segment) }),
    avatarsFor(channelIds),
  ]);
  // One round trip for every video on the page that had a thumbnail move — not one per card.
  const thumbRows = await thumbRowsFor(packagingVideoIds(page.events as any));
  const tests = testRowsForEvents(page.events as any, thumbRows);
  return (
    <FeedClient
      initialEvents={page.events as any}
      initialCursor={page.next_cursor}
      initialTests={tests}
      segment={segment}
      channelId={channelIds.length === 1 ? channelIds[0] : null}
      hasChannels
      avatars={avatars}
    />
  );
}

export default async function FeedPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, sp] = await Promise.all([requireAppUser(), searchParams]);
  if (!user) redirect('/sign-in');

  const tracked = await q<{ channel_id: string; name: string | null }>(
    `select uc.channel_id, coalesce(cm.title, cs.name) as name
       from user_channels uc
       left join channel_meta cm on cm.channel_id = uc.channel_id
       left join channel_stats cs on cs.channel_id = uc.channel_id
      where uc.user_id = $1
      order by 2 nulls last`,
    [user.id]
  );
  // A user with nothing tracked has nowhere to start; onboarding is that starting point.
  if (!tracked.length) redirect('/app/onboarding');

  const segment = parseSegment(sp.seg);
  const asked = Array.isArray(sp.channel) ? sp.channel[0] : sp.channel;
  const channelId = asked && tracked.some((t) => t.channel_id === asked) ? asked : null;
  const channelIds = channelId ? [channelId] : tracked.map((t) => t.channel_id);

  return (
    <div className="cs-feed-page">
      {/* The heading stands alone — no subtitle explaining what a feed is. */}
      <div className="cs-page-head" style={{ alignItems: 'center' }}>
        <h1 className="cs-h1">Feed</h1>
        <FeedControls segment={segment} channelId={channelId}
                      channels={tracked.map((t) => ({ id: t.channel_id, name: t.name || t.channel_id }))} />
      </div>
      <Suspense key={`${segment}:${channelId ?? 'all'}`} fallback={<FeedSkeleton />}>
        <FeedBody channelIds={channelIds} segment={segment} />
      </Suspense>
    </div>
  );
}
