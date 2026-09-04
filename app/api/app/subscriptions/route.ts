// GET  /api/app/subscriptions -> the user's YouTube subscriptions, flagged already-tracked
// POST /api/app/subscriptions { channel_ids } -> track them through the normal add path
//
// The Google token is Clerk's, from the connection the user signed in with. If the
// youtube.readonly scope has not been added to that connection Google answers 403; that
// becomes { code: 'missing_scope' } so the sheet can offer "Connect YouTube" instead of
// showing an error nobody can act on.
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
      error: 'This account is not connected to Google.',
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
    // The app_users row carries the clerk_id, so this works on the dev preview path too,
    // where middleware skips Clerk entirely and auth() would throw.
    const token = await googleAccessToken(user.clerk_id);
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
