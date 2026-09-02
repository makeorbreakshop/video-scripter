// GET /api/app/feed?cursor&limit&types -> { events, next_cursor }
// Keyset pagination over the signed-in user's tracked channels (lib/feed/query).
import { feedFor } from '@/lib/feed/query';
import { parseFeedParams } from '@/lib/app/feed-format';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await requireAppUser();
  if (!user) return unauthorized();

  const { cursor, limit, types } = parseFeedParams(new URL(req.url).searchParams);
  try {
    const page = await feedFor(user.id, { cursor, limit, types });
    return Response.json(page);
  } catch (e: any) {
    console.error('app feed GET:', e.message);
    return Response.json({ error: 'failed to load feed' }, { status: 500 });
  }
}
