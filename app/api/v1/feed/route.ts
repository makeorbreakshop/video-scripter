// GET /api/v1/feed?cursor=&limit=&types=&since= — the calling key's activity stream (since: ISO time, for polling).
import { NextResponse } from 'next/server';
import { feedFor, MAX_LIMIT, DEFAULT_LIMIT, FEED_TYPES } from '@/lib/feed/query';
import { withApiKey, intParam, listParam } from '@/lib/api/v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiKey(async (req, caller) => {
  const url = new URL(req.url);
  const page = await feedFor(caller.userId, {
    cursor: url.searchParams.get('cursor'),
    limit: intParam(url, 'limit', DEFAULT_LIMIT, MAX_LIMIT),
    types: listParam(url, 'types'),
    since: url.searchParams.get('since'),
  });
  return NextResponse.json({
    events: page.events.map((e) => ({
      id: e.id,
      type: e.type,
      at: e.at,
      channel: { id: e.channel_id, name: e.channel_name },
      video: e.video_id
        ? { id: e.video_id, title: e.video_title, thumbnail_url: e.thumbnail_url, published_at: e.published_at }
        : null,
      payload: e.payload,
    })),
    next_cursor: page.next_cursor,
    // Advertised so a client can build a type filter without hardcoding our vocabulary.
    types: FEED_TYPES,
  });
});
