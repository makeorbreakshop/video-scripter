// /app/feed — the event stream for everything the user tracks. The first page is read
// straight from Postgres so the feed paints without a client round trip; scrolling
// pages through /api/app/feed.
//
// Filtering is URL state (`seg`, `channel`), so a filtered feed is a link and the server still
// renders the first page. The head — heading and the one control row on its line — is rendered
// from the tracked-channel check alone; the feed query, the packaging versions and the avatar
// lookup stream into a <Suspense> boundary behind the route's skeleton. The feed is per-user,
// so none of it is cached.
//
// Round trips are the budget here, not query time: at 500 channels the shell read, the feed
// read and the per-page decoration each cost a network RTT to Postgres that dwarfs their few
// milliseconds of execution. So the shell is one query (lib/app/feed-loader.ts), and the two
// reads that decorate a page run together.
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireAppUser } from '@/lib/app/session';
import { feedForChannels } from '@/lib/feed/query';
import { avatarsFor } from '@/lib/app/channel-meta';
import { feedShell, resolveSelection, avatarChannelIds, type FeedShell } from '@/lib/app/feed-loader';
import { parseSegment, segmentTypes, type FeedSegment } from '@/lib/app/feed-format';
import { packagingVideoIds, testRowsForEvents } from '@/lib/app/feed-tests';
import { thumbRowsFor } from '@/lib/app/packaging-rows';
import { FeedSkeleton } from '@/components/app/skeletons';
import FeedClient from '../_components/feed-client';
import { FeedControls } from '../_components/feed-controls';

export const dynamic = 'force-dynamic';
// Three bounded reads. Anything past this is a stuck connection, not a slow page, and the
// route should fail rather than hold a streaming response open.
export const maxDuration = 20;

/** The page size the server renders and the client keeps asking for. */
const PAGE = 60;

async function FeedBody({ channelIds, segment, channelId }: {
  channelIds: string[]; segment: FeedSegment; channelId: string | null;
}) {
  const page = await feedForChannels(channelIds, { limit: PAGE, types: segmentTypes(segment) });
  // Both reads depend on the page and on nothing else, so they share one round trip's latency.
  // Avatars are for the channels on this page, not for all 500 the user tracks.
  const [avatars, thumbRows] = await Promise.all([
    avatarsFor(avatarChannelIds(page.events as any)),
    thumbRowsFor(packagingVideoIds(page.events as any)),
  ]);
  return (
    <FeedClient
      initialEvents={page.events as any}
      initialCursor={page.next_cursor}
      initialTests={testRowsForEvents(page.events as any, thumbRows)}
      segment={segment}
      channelId={channelId}
      hasChannels
      avatars={avatars}
    />
  );
}

function Head({ segment, selected, shell }: {
  segment: FeedSegment; selected: string | null; shell: FeedShell;
}) {
  return (
    // The heading stands alone — no subtitle explaining what a feed is.
    <div className="cs-page-head" style={{ alignItems: 'center' }}>
      <h1 className="cs-h1">Feed</h1>
      <FeedControls
        segment={segment}
        channelId={selected}
        groups={shell.groups.map((g) => ({
          id: g.id,
          name: g.name,
          color: g.color,
          count: shell.tracked.filter((t) => (shell.memberships[t.channel_id] || []).includes(g.id)).length,
        }))}
        channels={shell.tracked.map((t) => ({ id: t.channel_id, name: t.name || t.channel_id }))} />
    </div>
  );
}

export default async function FeedPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, sp] = await Promise.all([requireAppUser(), searchParams]);
  if (!user) redirect('/sign-in');

  // Tracked channels, groups and memberships in one read — they used to be three.
  const shell = await feedShell(user.id);
  // A user with nothing tracked has nowhere to start; onboarding is that starting point.
  if (!shell.tracked.length) redirect('/app/onboarding');

  const segment = parseSegment(sp.seg);
  const { channelIds, selected, channelId } = resolveSelection(sp.channel, shell);

  return (
    <div className="cs-feed-page">
      <Head segment={segment} selected={selected} shell={shell} />
      <Suspense key={`${segment}:${selected ?? 'all'}`} fallback={<FeedSkeleton />}>
        <FeedBody channelIds={channelIds} segment={segment} channelId={channelId} />
      </Suspense>
    </div>
  );
}
