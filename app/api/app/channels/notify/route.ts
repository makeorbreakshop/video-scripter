// POST /api/app/channels/notify  { channel_ids: string[], on: boolean }
//
// The plan's "tracked" number is now the NOTIFY limit — tracking itself is uncapped, and
// being notified about a channel is the part that costs. Switching a batch on is checked
// against that limit as a whole and refused rather than half-applied.
import { setNotify, notifyCount, notifyOffCount } from '@/lib/app/channel-groups';
import { canNotifyMore, notifyGate } from '@/lib/app/groups-view';
import { planUsage } from '@/lib/app/users';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await requireAppUser();
  if (!user) return unauthorized();
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid JSON body' }, { status: 400 }); }
  const ids = Array.isArray(body?.channel_ids) ? body.channel_ids.filter((s: any) => typeof s === 'string') : null;
  if (!ids?.length) return Response.json({ error: 'channel_ids must be a non-empty array' }, { status: 400 });
  const on = body?.on !== false;

  try {
    const usage = await planUsage(user.id);
    if (on) {
      const [count, adding] = await Promise.all([notifyCount(user.id), notifyOffCount(user.id, ids)]);
      const check = canNotifyMore(count, usage.limits.tracked, adding);
      if (!check.ok) return Response.json({ error: check.reason, code: 'notify_limit' }, { status: 402 });
    }
    const changed = await setNotify(user.id, ids, on);
    const count = await notifyCount(user.id);
    return Response.json({ changed, on, ...notifyGate(count, usage.limits.tracked) });
  } catch (e: any) {
    console.error('notify POST:', e.message);
    return Response.json({ error: 'failed to update notifications' }, { status: 500 });
  }
}
