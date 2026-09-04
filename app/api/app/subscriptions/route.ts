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
import { trackChannel, resolveChannelsByIds } from '@/lib/app/channels';
import { chunkIds, planImport, mapWithConcurrency, SERVER_CHUNK, SERVER_CONCURRENCY } from '@/lib/app/import-batch';
import { q } from '@/lib/admin/db';
import { CHANNEL_ID_RE } from '@/lib/app/channels-core';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The sheet posts in batches of 50 (lib/app/import-batch, CLIENT_BATCH) so it can draw real
// progress, and 50 channels finish well inside this. 300s is the ceiling this project already
// runs its long routes at (app/api/view-tracking/run), i.e. the Vercel plan's limit.
export const maxDuration = 300;

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

  // No cap. Anything already tracked is skipped rather than re-added, so re-posting the same
  // ids is a no-op — a retry after a dropped batch costs nothing and changes nothing.
  const have = await q<{ channel_id: string }>(
    `select channel_id from user_channels where user_id = $1 and channel_id = any($2::text[])`,
    [user.id, ids]
  );
  const { add, skip } = planImport(ids, have.map((r) => r.channel_id));

  // channels.list takes 50 ids per unit, so the identities for the whole request cost a
  // handful of units up front and trackChannel spends none of its own resolving them.
  const resolved = add.length ? await resolveChannelsByIds(add).catch(() => new Map()) : new Map();

  let tracked = 0;
  const failed: Array<{ channel_id: string; reason: string }> = [];
  const done: string[] = [];
  // Chunks of 25 with four in flight: enough parallelism that 50 channels land in seconds,
  // bounded enough that a big import is a trickle of YouTube calls rather than a spike.
  for (const group of chunkIds(add, SERVER_CHUNK)) {
    const results = await mapWithConcurrency(group, SERVER_CONCURRENCY, (id) =>
      trackChannel(user.id, id, 'competitor', { resolved: resolved.get(id) ?? null })
    );
    results.forEach((r, i) => {
      const id = group[i];
      if (r.ok) { tracked += 1; done.push(id); }
      else {
        failed.push({ channel_id: id, reason: String(r.error?.message || 'could not be added') });
        console.error('subscriptions import:', id, r.error?.message);
      }
    });
  }

  await recordImported(user.id, [...done, ...skip]);
  return Response.json({ requested: ids.length, tracked, skipped: skip.length, failed });
}
