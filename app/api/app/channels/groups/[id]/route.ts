// PATCH  /api/app/channels/groups/[id]  { name? , color? } -> rename / recolour
// DELETE /api/app/channels/groups/[id]                     -> delete (memberships cascade)
import { renameGroup, recolorGroup, deleteGroup, GroupNameTakenError } from '@/lib/app/channel-groups';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireAppUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid JSON body' }, { status: 400 }); }
  try {
    let group = null;
    if (typeof body?.name === 'string') group = await renameGroup(user.id, id, body.name);
    if (typeof body?.color === 'string') group = await recolorGroup(user.id, id, body.color);
    if (!group) return Response.json({ error: 'no such group' }, { status: 404 });
    return Response.json({ group });
  } catch (e: any) {
    if (e instanceof GroupNameTakenError) return Response.json({ error: e.message, code: 'name_taken' }, { status: 409 });
    if (/needs a name|group colour/.test(e.message)) return Response.json({ error: e.message }, { status: 400 });
    console.error('group PATCH:', e.message);
    return Response.json({ error: 'failed to update the group' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireAppUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  try {
    const gone = await deleteGroup(user.id, id);
    if (!gone) return Response.json({ error: 'no such group' }, { status: 404 });
    return Response.json({ id, deleted: true });
  } catch (e: any) {
    console.error('group DELETE:', e.message);
    return Response.json({ error: 'failed to delete the group' }, { status: 500 });
  }
}
