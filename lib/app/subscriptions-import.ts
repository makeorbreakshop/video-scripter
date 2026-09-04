// Import the channels a user already subscribes to on YouTube.
//
// The access token comes from Clerk's Google connection, not from our own OAuth client:
// Clerk already holds the grant for the account the user signed in with. It needs the
// youtube.readonly scope added to that connection (see the report in the PR) — without it
// Google answers 403 and we surface a "Connect YouTube" action rather than a stack trace.
import { clerkClient } from '@clerk/nextjs/server';
import { q } from '../admin/db';

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

/** Clerk holds the Google OAuth token for the signed-in user; ask it, do not store one. */
export async function googleAccessToken(clerkUserId: string): Promise<string> {
  let list: any[] = [];
  try {
    const client = await clerkClient();
    const res: any = await client.users.getUserOauthAccessToken(clerkUserId, 'oauth_google');
    list = Array.isArray(res) ? res : (res?.data ?? []);
  } catch (e: any) {
    // Clerk answers 404 when this instance does not know the user (a live clerk_id read by a
    // dev instance) and 4xx when the account has no Google connection. Either way the person
    // needs to connect an account, which is something they can act on — not a 500.
    if (e?.status >= 400 && e.status < 500) {
      throw new NoGoogleAccountError('This account is not connected to Google.');
    }
    throw e;
  }
  const token = list[0]?.token;
  if (!token) throw new NoGoogleAccountError('This account is not connected to Google.');
  return token;
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
