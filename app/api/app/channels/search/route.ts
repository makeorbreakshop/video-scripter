// POST /api/app/channels/search  { q } -> { results: [{channel_id,name,video_count,tracked_lane}] }
// Prefix search over the channels we already know about. No YouTube quota.
import { searchTracked } from '@/lib/app/channels';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await requireAppUser();
  if (!user) return unauthorized();

  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid JSON body' }, { status: 400 }); }
  const q = typeof body?.q === 'string' ? body.q : '';
  if (q.trim().length < 2) return Response.json({ results: [] });

  try {
    return Response.json({ results: await searchTracked(q) });
  } catch (e: any) {
    console.error('channels/search:', e.message);
    return Response.json({ error: 'search failed' }, { status: 500 });
  }
}
