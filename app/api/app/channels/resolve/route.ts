// POST /api/app/channels/resolve  { input }
//   -> { ref, channel, suggestions }   (channel null + suggestions = close matches for a bad handle)
// Parses any URL/@handle/UC id/video link/free text. URL-ish inputs cost 1-2
// YouTube units (logged to quota_ledger as 'app-resolve'); free text costs none
// and returns local search suggestions instead.
import { resolveInput } from '@/lib/app/channels';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await requireAppUser();
  if (!user) return unauthorized();

  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid JSON body' }, { status: 400 }); }
  const input = typeof body?.input === 'string' ? body.input.trim() : '';
  if (!input) return Response.json({ error: 'input is required' }, { status: 400 });

  try {
    const out = await resolveInput(input);
    // A miss with close local matches is still a useful answer (a mistyped @handle);
    // only a miss with nothing to offer is a 404.
    if (out.ref.kind !== 'search' && !out.channel && out.suggestions.length === 0) {
      return Response.json({ ...out, error: 'channel not found' }, { status: 404 });
    }
    return Response.json(out);
  } catch (e: any) {
    console.error('channels/resolve:', e.message);
    const quota = /\b(403|429)\b/.test(e.message || '');
    return Response.json(
      { error: quota ? 'YouTube quota exhausted; try again later' : 'resolve failed' },
      { status: quota ? 503 : 502 }
    );
  }
}
