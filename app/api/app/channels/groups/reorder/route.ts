// POST /api/app/channels/groups/reorder  { ids: string[] } -> chips take that order
import { reorderGroups, listGroups } from '@/lib/app/channel-groups';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await requireAppUser();
  if (!user) return unauthorized();
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid JSON body' }, { status: 400 }); }
  const ids = Array.isArray(body?.ids) ? body.ids.filter((s: any) => typeof s === 'string') : null;
  if (!ids?.length) return Response.json({ error: 'ids must be a non-empty array' }, { status: 400 });
  try {
    await reorderGroups(user.id, ids);
    return Response.json({ groups: await listGroups(user.id) });
  } catch (e: any) {
    console.error('groups reorder:', e.message);
    return Response.json({ error: 'failed to reorder the groups' }, { status: 500 });
  }
}
