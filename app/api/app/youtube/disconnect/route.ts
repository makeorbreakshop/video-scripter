// POST /api/app/youtube/disconnect { channel_id } — forget the grant (the refresh token).
import { removeConnection } from '@/lib/app/youtube-connect';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await requireAppUser();
  if (!user) return unauthorized();
  const body = await req.json().catch(() => null);
  const channelId = typeof body?.channel_id === 'string' ? body.channel_id : '';
  if (!channelId) return Response.json({ error: 'channel_id is required' }, { status: 400 });
  await removeConnection(user.id, channelId);
  return Response.json({ ok: true });
}
