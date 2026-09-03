// GET /api/app/channels/:id/videos?sort=&range=&limit=&offset=
//
// The grid's own pager. /api/v1/… is the public, API-key'd surface and returns a different
// shape with no offset, so "Load more" gets an internal route that hands back exactly what
// channelVideos() returns — the same GridVideo rows the server page rendered.
import { parseSort, parseRange, GRID_PAGE } from '@/lib/app/channel-page';
import { cachedChannelVideos } from '@/lib/app/cached';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHANNEL_ID = /^[\w-]{2,64}$/;
const MAX_LIMIT = 120;
const MAX_OFFSET = 480;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireAppUser();
  if (!user) return unauthorized();

  const { id } = await ctx.params;
  if (!CHANNEL_ID.test(id)) return Response.json({ error: 'bad channel id' }, { status: 400 });

  const url = new URL(req.url);
  const sort = parseSort(url.searchParams.get('sort'));
  const range = parseRange(url.searchParams.get('range'));
  const num = (name: string, fallback: number, max: number) => {
    const raw = parseInt(url.searchParams.get(name) ?? '', 10);
    return Number.isFinite(raw) ? Math.min(Math.max(raw, 0), max) : fallback;
  };
  const limit = Math.max(1, num('limit', GRID_PAGE, MAX_LIMIT));
  const offset = num('offset', 0, MAX_OFFSET);

  try {
    // Same tagged cache the page render uses, so paging back over a page you already scrolled
    // past does not re-run the query.
    const page = await cachedChannelVideos(id, sort, limit, offset, range);
    return Response.json(page, { headers: { 'cache-control': 'private, no-store' } });
  } catch (e: any) {
    console.error('app channel videos:', e?.message);
    return Response.json({ error: 'failed to load videos' }, { status: 500 });
  }
}
