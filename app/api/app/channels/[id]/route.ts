// DELETE /api/app/channels/[id] -> stop tracking a channel for this user.
import { untrackChannel } from '@/lib/app/channels';
import { CHANNEL_ID_RE } from '@/lib/app/channels-core';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireAppUser();
  if (!user) return unauthorized();

  const { id } = await ctx.params;
  if (!CHANNEL_ID_RE.test(id)) {
    return Response.json({ error: 'channel id must be a UC… YouTube channel id' }, { status: 400 });
  }

  try {
    const out = await untrackChannel(user.id, id);
    if (!out.removed) return Response.json({ error: 'not tracked' }, { status: 404 });
    return Response.json({ channel_id: id, ...out });
  } catch (e: any) {
    console.error('channels DELETE:', e.message);
    return Response.json({ error: 'failed to untrack channel' }, { status: 500 });
  }
}
