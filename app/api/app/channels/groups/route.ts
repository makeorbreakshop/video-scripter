// GET  /api/app/channels/groups  -> { groups, memberships }
// POST /api/app/channels/groups  { name } -> the new group, coloured by its position
import { listGroups, listMemberships, createGroup, GroupNameTakenError } from '@/lib/app/channel-groups';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await requireAppUser();
  if (!user) return unauthorized();
  try {
    const [groups, memberships] = await Promise.all([listGroups(user.id), listMemberships(user.id)]);
    return Response.json({ groups, memberships });
  } catch (e: any) {
    console.error('groups GET:', e.message);
    return Response.json({ error: 'failed to load groups' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await requireAppUser();
  if (!user) return unauthorized();
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid JSON body' }, { status: 400 }); }
  try {
    const group = await createGroup(user.id, String(body?.name ?? ''));
    return Response.json({ group }, { status: 201 });
  } catch (e: any) {
    if (e instanceof GroupNameTakenError) return Response.json({ error: e.message, code: 'name_taken' }, { status: 409 });
    if (/needs a name/.test(e.message)) return Response.json({ error: e.message }, { status: 400 });
    console.error('groups POST:', e.message);
    return Response.json({ error: 'failed to create the group' }, { status: 500 });
  }
}
