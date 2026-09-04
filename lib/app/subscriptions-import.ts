// Import the channels a user already subscribes to on YouTube.
//
// The access token is the app's own: the grant the user made at /api/app/youtube/connect,
// stored in youtube_connections with its refresh token encrypted at rest (lib/app/crypto).
// That grant already carries youtube.readonly, so the same connection that powers the
// Analytics sync reads the subscription list — no second identity provider, and nothing that
// depends on which button the user signed in with. With no connection at all the sheet gets
// a "Connect YouTube" action pointing back at that route; Google's 403 is still surfaced as
// a missing scope, because a grant made before the scope was added would answer that way.
import { q } from '../admin/db';
import { decryptSecret } from './crypto';
import { accessTokenFromRefresh, listConnections } from './youtube-connect';

export class MissingScopeError extends Error {
  code = 'missing_scope' as const;
}
export class NoGoogleAccountError extends Error {
  code = 'no_google' as const;
}

export interface Subscription {
  channel_id: string;
  name: string;
  avatar_url: string | null;
  subscriber_count: number | null;
  tracked: boolean;
}

/**
 * A live access token for this user's own YouTube connection. The first connection is the
 * one: a user with two owned channels granted the same account both times, and the
 * subscription list is the account's, not the channel's.
 */
export async function googleAccessToken(userId: string): Promise<string> {
  const connections = await listConnections(userId);
  const first = connections[0];
  if (!first) throw new NoGoogleAccountError('This account is not connected to YouTube.');

  const row = await q<{ refresh_token: string }>(
    `select refresh_token from youtube_connections where user_id = $1 and channel_id = $2`,
    [userId, first.channel_id]
  );
  const stored = row[0]?.refresh_token;
  if (!stored) throw new NoGoogleAccountError('This account is not connected to YouTube.');

  try {
    return await accessTokenFromRefresh(decryptSecret(stored));
  } catch (e: any) {
    // A revoked or expired grant is something the user can act on: reconnect. Anything else
    // is ours.
    if (/invalid_grant|unauthorized_client|invalid_client/.test(e?.message || '')) {
      throw new NoGoogleAccountError('Your YouTube connection needs to be renewed.');
    }
    throw e;
  }
}

const PAGE = 50;
/** 40 pages of 50 is 2,000 subscriptions — past any real account, and a hard stop. */
const MAX_PAGES = 40;

/** subscriptions.list(mine=true), paged. Throws MissingScopeError on Google's 403. */
export async function fetchSubscriptions(accessToken: string): Promise<Array<{ channel_id: string; name: string; avatar_url: string | null }>> {
  const out: Array<{ channel_id: string; name: string; avatar_url: string | null }> = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const u = new URL('https://www.googleapis.com/youtube/v3/subscriptions');
    u.searchParams.set('part', 'snippet');
    u.searchParams.set('mine', 'true');
    u.searchParams.set('maxResults', String(PAGE));
    u.searchParams.set('order', 'alphabetical');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const res = await fetch(u, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    const body: any = await res.json().catch(() => ({}));
    if (res.status === 403 || res.status === 401) {
      throw new MissingScopeError(
        body?.error?.message || 'YouTube would not share this account’s subscriptions.'
      );
    }
    if (!res.ok) throw new Error(`subscriptions ${res.status}: ${body?.error?.message || ''}`);
    for (const it of body.items || []) {
      const id = it?.snippet?.resourceId?.channelId;
      if (!id) continue;
      out.push({
        channel_id: id,
        name: it.snippet.title || id,
        avatar_url: it.snippet.thumbnails?.default?.url || it.snippet.thumbnails?.medium?.url || null,
      });
    }
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/**
 * What the import sheet lists: the user's subscriptions, minus anything already imported
 * once, each flagged with whether it is tracked right now. Subscriber counts come from
 * channel_meta where we happen to know them — never from another YouTube call.
 */
export async function subscriptionsForImport(userId: string, subs: Array<{ channel_id: string; name: string; avatar_url: string | null }>): Promise<Subscription[]> {
  const ids = subs.map((s) => s.channel_id);
  if (!ids.length) return [];
  const [tracked, imported, meta] = await Promise.all([
    q<{ channel_id: string }>(
      `select channel_id from user_channels where user_id = $1 and channel_id = any($2::text[])`,
      [userId, ids]
    ),
    q<{ channel_id: string }>(
      `select channel_id from google_subscription_imports where user_id = $1 and channel_id = any($2::text[])`,
      [userId, ids]
    ),
    q<{ channel_id: string; subscriber_count: string | null; avatar_url: string | null }>(
      `select channel_id, subscriber_count, avatar_url from channel_meta where channel_id = any($1::text[])`,
      [ids]
    ),
  ]);
  const isTracked = new Set(tracked.map((r) => r.channel_id));
  const wasImported = new Set(imported.map((r) => r.channel_id));
  const byId = new Map(meta.map((m) => [m.channel_id, m]));

  return subs
    // Imported once and since removed is a decision, not an oversight: do not re-offer it.
    .filter((s) => isTracked.has(s.channel_id) || !wasImported.has(s.channel_id))
    .map((s) => {
      const m = byId.get(s.channel_id);
      const n = m?.subscriber_count == null ? null : Number(m.subscriber_count);
      return {
        channel_id: s.channel_id,
        name: s.name,
        avatar_url: s.avatar_url || m?.avatar_url || null,
        subscriber_count: Number.isFinite(n as number) ? (n as number) : null,
        tracked: isTracked.has(s.channel_id),
      };
    });
}

/** Record what we imported, so a second run offers only what is new. */
export async function recordImported(userId: string, channelIds: string[]): Promise<void> {
  const ids = Array.from(new Set(channelIds.filter(Boolean)));
  if (!ids.length) return;
  await q(
    `insert into google_subscription_imports (user_id, channel_id)
     select $1, c FROM unnest($2::text[]) as c
     on conflict (user_id, channel_id) do nothing`,
    [userId, ids]
  );
}
