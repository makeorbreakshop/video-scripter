// POST /api/app/channels/avatar { channel_id } -> { avatar_url }
// The browser calls this when an avatar <img> fails to load: YouTube rotates avatar URLs, so
// we re-fetch the channel (1 unit, at most once per channel per day) and hand back the current one.
import { refreshAvatar } from '@/lib/app/channels';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await requireAppUser();
  if (!user) return unauthorized();
  const body = await req.json().catch(() => null);
  const channelId = typeof body?.channel_id === 'string' ? body.channel_id : '';
  if (!channelId) return Response.json({ error: 'channel_id is required' }, { status: 400 });
  try {
    return Response.json({ avatar_url: await refreshAvatar(channelId) });
  } catch (e: any) {
    console.error('channels/avatar:', e.message);
    return Response.json({ avatar_url: null });
  }
}
