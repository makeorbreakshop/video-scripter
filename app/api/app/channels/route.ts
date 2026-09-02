// GET  /api/app/channels        -> { channels: [...], plan, limits }
// POST /api/app/channels        { channel_id, role?, watched_closely? } -> track
import { listUserChannels, trackChannel, PlanLimitError } from '@/lib/app/channels';
import { CHANNEL_ID_RE } from '@/lib/app/channels-core';
import { planUsage } from '@/lib/app/users';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await requireAppUser();
  if (!user) return unauthorized();
  try {
    const [channels, usage] = await Promise.all([listUserChannels(user.id), planUsage(user.id)]);
    return Response.json({ channels, plan: usage.plan, limits: usage.limits, usage: { tracked: usage.tracked, watched_closely: usage.watchedClosely } });
  } catch (e: any) {
    console.error('channels GET:', e.message);
    return Response.json({ error: 'failed to load channels' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await requireAppUser();
  if (!user) return unauthorized();

  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid JSON body' }, { status: 400 }); }
  const channelId = typeof body?.channel_id === 'string' ? body.channel_id.trim() : '';
  const role = body?.role === 'self' ? 'self' : 'competitor';
  const watchedClosely = body?.watched_closely === true;

  if (!CHANNEL_ID_RE.test(channelId)) {
    return Response.json({ error: 'channel_id must be a UC… YouTube channel id' }, { status: 400 });
  }

  try {
    const result = await trackChannel(user.id, channelId, role, { watchedClosely });
    return Response.json(result, { status: 201 });
  } catch (e: any) {
    if (e instanceof PlanLimitError) return Response.json({ error: e.message, code: 'plan_limit' }, { status: 402 });
    console.error('channels POST:', e.message);
    return Response.json({ error: 'failed to track channel' }, { status: 500 });
  }
}
