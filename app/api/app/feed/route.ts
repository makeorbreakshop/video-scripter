// GET /api/app/feed?cursor&limit&seg&channel -> { events, next_cursor, tests, avatars }
// Keyset pagination over the signed-in user's tracked channels (lib/feed/query), plus the
// packaging tests the page's videos read as and the avatars its channels need, so a
// scrolled-in page renders the same TestRows the server-rendered first page did. One
// versions read and one avatars read per page, never one per card.
import { feedForChannels } from '@/lib/feed/query';
import { parseSegment, segmentTypes } from '@/lib/app/feed-format';
import { packagingVideoIds, testRowsForEvents } from '@/lib/app/feed-tests';
import { thumbRowsFor } from '@/lib/app/packaging-rows';
import { avatarsFor } from '@/lib/app/channel-meta';
import { avatarChannelIds } from '@/lib/app/feed-loader';
import { requireAppUser, unauthorized } from '@/lib/app/session';
import { clampLimit } from '@/lib/feed/query';
import { q } from '@/lib/admin/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Two bounded reads. Past this the connection is stuck, not slow.
export const maxDuration = 20;

export async function GET(req: Request) {
  const user = await requireAppUser();
  if (!user) return unauthorized();

  const sp = new URL(req.url).searchParams;
  const limit = clampLimit(parseInt(sp.get('limit') || '', 10));
  const segment = parseSegment(sp.get('seg'));
  const asked = sp.get('channel');

  try {
    const tracked = await q<{ channel_id: string }>('select channel_id from user_channels where user_id = $1', [user.id]);
    const ids = tracked.map((t) => t.channel_id);
    const channelIds = asked && ids.includes(asked) ? [asked] : ids;
    const page = await feedForChannels(channelIds, { cursor: sp.get('cursor'), limit, types: segmentTypes(segment) });
    const [thumbRows, avatars] = await Promise.all([
      thumbRowsFor(packagingVideoIds(page.events as any)),
      avatarsFor(avatarChannelIds(page.events as any)),
    ]);
    return Response.json({ ...page, tests: testRowsForEvents(page.events as any, thumbRows), avatars });
  } catch (e: any) {
    console.error('app feed GET:', e.message);
    return Response.json({ error: 'failed to load feed' }, { status: 500 });
  }
}
