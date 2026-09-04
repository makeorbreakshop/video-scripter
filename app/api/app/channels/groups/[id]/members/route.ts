// POST /api/app/channels/groups/[id]/members  { channel_ids: string[], op: 'add' | 'remove' }
// Bulk membership, one round trip for a whole selection.
import { addToGroup, removeFromGroup } from '@/lib/app/channel-groups';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireAppUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid JSON body' }, { status: 400 }); }

  const ids = Array.isArray(body?.channel_ids) ? body.channel_ids.filter((s: any) => typeof s === 'string') : null;
  if (!ids) return Response.json({ error: 'channel_ids must be an array' }, { status: 400 });
  const op = body?.op === 'remove' ? 'remove' : 'add';

  try {
    const changed = op === 'add'
      ? await addToGroup(user.id, id, ids)
      : await removeFromGroup(user.id, id, ids);
    return Response.json({ group_id: id, op, changed });
  } catch (e: any) {
    console.error('group members POST:', e.message);
    return Response.json({ error: 'failed to update the group' }, { status: 500 });
  }
}
