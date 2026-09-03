// GET /api/app/feed?cursor&limit&seg&channel -> { events, next_cursor, tests }
// Keyset pagination over the signed-in user's tracked channels (lib/feed/query), plus the
// packaging tests the page's videos read as, so a scrolled-in page renders the same TestRows
// the server-rendered first page did. One versions read per page, never one per card.
import { feedForChannels } from '@/lib/feed/query';
import { parseSegment, segmentTypes } from '@/lib/app/feed-format';
import { packagingVideoIds, testRowsForEvents } from '@/lib/app/feed-tests';
import { thumbRowsFor } from '@/lib/app/packaging-rows';
import { requireAppUser, unauthorized } from '@/lib/app/session';
import { q } from '@/lib/admin/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await requireAppUser();
  if (!user) return unauthorized();

  const sp = new URL(req.url).searchParams;
  const rawLimit = parseInt(sp.get('limit') || '', 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 25;
  const segment = parseSegment(sp.get('seg'));
  const asked = sp.get('channel');

  try {
    const tracked = await q<{ channel_id: string }>('select channel_id from user_channels where user_id = $1', [user.id]);
    const ids = tracked.map((t) => t.channel_id);
    const channelIds = asked && ids.includes(asked) ? [asked] : ids;
    const page = await feedForChannels(channelIds, { cursor: sp.get('cursor'), limit, types: segmentTypes(segment) });
    const thumbRows = await thumbRowsFor(packagingVideoIds(page.events as any));
    return Response.json({ ...page, tests: testRowsForEvents(page.events as any, thumbRows) });
  } catch (e: any) {
    console.error('app feed GET:', e.message);
    return Response.json({ error: 'failed to load feed' }, { status: 500 });
  }
}
