// DELETE /api/app/keys/[id] -> revoke (soft delete; last_used_at stays auditable).
import { revokeKey } from '@/lib/app/api-keys';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireAppUser();
  if (!user) return unauthorized();

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return Response.json({ error: 'invalid key id' }, { status: 400 });

  try {
    const revoked = await revokeKey(user.id, id);
    if (!revoked) return Response.json({ error: 'not found or already revoked' }, { status: 404 });
    return Response.json({ id, revoked: true });
  } catch (e: any) {
    console.error('keys DELETE:', e.message);
    return Response.json({ error: 'failed to revoke API key' }, { status: 500 });
  }
}
