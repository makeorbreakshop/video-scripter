// POST /api/app/youtube/disconnect { channel_id } — forget the grant AND the private
// analytics it produced. This is the user-facing deletion path.
import { deleteChannelData } from '@/lib/app/analytics-privacy';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await requireAppUser();
  if (!user) return unauthorized();
  const body = await req.json().catch(() => null);
  const channelId = typeof body?.channel_id === 'string' ? body.channel_id : '';
  if (!channelId) return Response.json({ error: 'channel_id is required' }, { status: 400 });
  // Disconnecting removes the private analytics the grant produced, not just the token.
  try {
    return Response.json({ ok: true, ...(await deleteChannelData(user.id, channelId)) });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 404 });
  }
}
