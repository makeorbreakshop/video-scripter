// GET  /api/app/keys        -> { keys: [...] }        (never the plaintext)
// POST /api/app/keys {label} -> { key, row }          (plaintext, once)
import { createKey, listKeys } from '@/lib/app/api-keys';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await requireAppUser();
  if (!user) return unauthorized();
  try {
    return Response.json({ keys: await listKeys(user.id) });
  } catch (e: any) {
    console.error('keys GET:', e.message);
    return Response.json({ error: 'failed to load API keys' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await requireAppUser();
  if (!user) return unauthorized();

  let body: any = {};
  try { body = await req.json(); } catch { /* label is optional, an empty body is fine */ }
  const raw = typeof body?.label === 'string' ? body.label.trim() : '';
  if (raw.length > 60) return Response.json({ error: 'label must be 60 characters or fewer' }, { status: 400 });

  try {
    const { key, row } = await createKey(user.id, raw || null);
    return Response.json({ key, row }, { status: 201 });
  } catch (e: any) {
    console.error('keys POST:', e.message);
    return Response.json({ error: 'failed to create API key' }, { status: 500 });
  }
}
