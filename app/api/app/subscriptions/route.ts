// GET  /api/app/subscriptions -> the user's YouTube subscriptions, flagged already-tracked
// POST /api/app/subscriptions { channel_ids } -> track them through the normal add path
//
// The Google token is the app's own — the grant made at /api/app/youtube/connect, whose
// refresh token lives encrypted in youtube_connections. With no connection the sheet gets
// { code: 'no_google' }; with a grant that predates youtube.readonly Google answers 403 and
// that becomes { code: 'missing_scope' }. Both carry connect_url, so the sheet always has
// something to click instead of an error nobody can act on.
import {
  googleAccessToken, fetchSubscriptions, subscriptionsForImport, recordImported,
  MissingScopeError, NoGoogleAccountError,
} from '@/lib/app/subscriptions-import';
import { trackChannel } from '@/lib/app/channels';
import { CHANNEL_ID_RE } from '@/lib/app/channels-core';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How many channels one POST may add. Each one can cost a resolve plus a fast sync. */
const IMPORT_CAP = 100;

function scopeError(e: unknown) {
  if (e instanceof MissingScopeError) {
    return Response.json({
      error: 'ChannelSmith cannot read your YouTube subscriptions yet.',
      code: 'missing_scope',
      connect_url: '/api/app/youtube/connect',
    }, { status: 403 });
  }
  if (e instanceof NoGoogleAccountError) {
    return Response.json({
      error: e.message || 'This account is not connected to YouTube.',
      code: 'no_google',
      connect_url: '/api/app/youtube/connect',
    }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const user = await requireAppUser();
  if (!user) return unauthorized();

  try {
    const token = await googleAccessToken(user.id);
    const subs = await fetchSubscriptions(token);
    const items = await subscriptionsForImport(user.id, subs);
    return Response.json({
      subscriptions: items,
      total: subs.length,
      tracked: items.filter((s) => s.tracked).length,
    });
  } catch (e: any) {
    const scoped = scopeError(e);
    if (scoped) return scoped;
    console.error('subscriptions GET:', e.message);
    return Response.json({ error: 'could not read your subscriptions' }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const user = await requireAppUser();
  if (!user) return unauthorized();
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid JSON body' }, { status: 400 }); }
  const ids: string[] = Array.from(new Set(
    (Array.isArray(body?.channel_ids) ? body.channel_ids : []).filter((s: any) => typeof s === 'string' && CHANNEL_ID_RE.test(s))
  ));
  if (!ids.length) return Response.json({ error: 'channel_ids must be an array of UC… ids' }, { status: 400 });
  if (ids.length > IMPORT_CAP) return Response.json({ error: `Import at most ${IMPORT_CAP} channels at a time.` }, { status: 400 });

  // Serial on purpose: trackChannel can resolve, fast-sync and queue backfills, and a
  // hundred of those in parallel is a YouTube-quota incident.
  let tracked = 0;
  const failed: string[] = [];
  for (const id of ids) {
    try { await trackChannel(user.id, id, 'competitor'); tracked += 1; }
    catch (e: any) { failed.push(id); console.error('subscriptions import:', id, e.message); }
  }
  await recordImported(user.id, ids.filter((id) => !failed.includes(id)));
  return Response.json({ requested: ids.length, tracked, failed });
}
