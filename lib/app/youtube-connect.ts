// Owner-channel YouTube connection: OAuth (server-side, offline refresh token) and the
// Analytics API reads it unlocks. Direct Postgres only (lib/admin/db.ts).
//
// Pure pieces (auth URL, callback parsing, analytics row mapping) are separated from the
// network/database pieces so they can be unit tested.
import { q, one } from '../admin/db';
import { encryptSecret, decryptSecret } from './crypto';

export const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

export const OAUTH_STATE_COOKIE = 'cs_yt_oauth_state';
/** The path Google is allowed to send the user back to (registered on the OAuth client). */
export const CALLBACK_PATH = '/oauth-callback';

export function oauthClient(): { clientId: string; clientSecret: string } {
  const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new Error('YouTube OAuth client is not configured');
  return { clientId, clientSecret };
}

/**
 * Where Google sends the user back. Prefer the configured value: it must match a URI
 * registered on the OAuth client exactly, and deriving it from the request host is fragile
 * (channelsmith.com redirects to www, so the origin is not the registered domain) as well
 * as attacker-influencable via the Host header. Falls back to the request origin for local
 * development, where http://localhost:3000/oauth-callback is registered.
 */
export function redirectUriFor(origin: string): string {
  const configured = (process.env.YOUTUBE_REDIRECT_URI || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  return `${origin.replace(/\/$/, '')}${CALLBACK_PATH}`;
}

/** Google consent URL. offline + consent forces a refresh token on every grant. */
export function buildAuthUrl(o: { clientId: string; redirectUri: string; state: string }): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', o.clientId);
  u.searchParams.set('redirect_uri', o.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', YT_SCOPES.join(' '));
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', o.state);
  return u.toString();
}

export type CallbackParse =
  | { ok: true; code: string }
  | { ok: false; reason: 'denied' | 'state' | 'missing' };

/** Validate what Google sent back against the state cookie we set. */
export function parseCallback(params: URLSearchParams, expectedState: string | undefined): CallbackParse {
  if (params.get('error')) return { ok: false, reason: 'denied' };
  const state = params.get('state');
  if (!expectedState || !state || state !== expectedState) return { ok: false, reason: 'state' };
  const code = params.get('code');
  return code ? { ok: true, code } : { ok: false, reason: 'missing' };
}

interface TokenResponse { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string }

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15000),
  });
  return res.json() as Promise<TokenResponse>;
}

/** code -> tokens. Throws when Google refuses. */
export async function exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken: string; scopes: string[] }> {
  const { clientId, clientSecret } = oauthClient();
  const t = await tokenRequest({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  if (!t.access_token) throw new Error(`token exchange failed: ${t.error} ${t.error_description || ''}`.trim());
  if (!t.refresh_token) throw new Error('Google did not return a refresh token (grant already existed without prompt=consent)');
  return { accessToken: t.access_token, refreshToken: t.refresh_token, scopes: (t.scope || '').split(' ').filter(Boolean) };
}

export async function accessTokenFromRefresh(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = oauthClient();
  const t = await tokenRequest({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' });
  if (!t.access_token) throw new Error(`token refresh failed: ${t.error} ${t.error_description || ''}`.trim());
  return t.access_token;
}

/** channels.list mine=true — which channel this grant belongs to. */
export async function ownedChannel(accessToken: string): Promise<{ id: string; title: string } | null> {
  const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true', {
    headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000),
  });
  const d = await res.json();
  const it = d.items?.[0];
  return it ? { id: it.id, title: it.snippet?.title || it.id } : null;
}

// ------------------------------------------------------------- storage ----

export interface Connection {
  user_id: string; channel_id: string; channel_title: string | null; refresh_token: string;
  scopes: string[]; connected_at: string; last_synced_at: string | null; last_error: string | null;
}

export async function saveConnection(c: { userId: string; channelId: string; channelTitle: string | null; refreshToken: string; scopes: string[] }): Promise<void> {
  await q(
    `insert into youtube_connections (user_id, channel_id, channel_title, refresh_token, scopes, connected_at, last_error)
     values ($1,$2,$3,$4,$5, now(), null)
     on conflict (user_id, channel_id) do update
       set channel_title = excluded.channel_title, refresh_token = excluded.refresh_token,
           scopes = excluded.scopes, connected_at = now(), last_error = null`,
    [c.userId, c.channelId, c.channelTitle, encryptSecret(c.refreshToken), c.scopes]
  );
}

export async function removeConnection(userId: string, channelId: string): Promise<void> {
  await q(`delete from youtube_connections where user_id = $1 and channel_id = $2`, [userId, channelId]);
}

/** What the settings page shows: never the token. */
export type ConnectionView = Omit<Connection, 'refresh_token'> & { avatar_url: string | null };

export async function listConnections(userId: string): Promise<ConnectionView[]> {
  return q<ConnectionView>(
    `select yc.user_id, yc.channel_id, coalesce(yc.channel_title, cm.title) as channel_title,
            cm.avatar_url, yc.scopes, yc.connected_at, yc.last_synced_at, yc.last_error
       from youtube_connections yc
       left join channel_meta cm on cm.channel_id = yc.channel_id
      where yc.user_id = $1 order by yc.connected_at`,
    [userId]
  );
}

export async function allConnections(): Promise<Connection[]> {
  const rows = await q<Connection>(`select * from youtube_connections order by connected_at`);
  // Tokens are stored encrypted (lib/app/crypto.ts); legacy plaintext passes through.
  return rows.map((r) => ({ ...r, refresh_token: decryptSecret(r.refresh_token) }));
}

export async function markSynced(userId: string, channelId: string, error: string | null): Promise<void> {
  await q(
    `update youtube_connections set last_synced_at = case when $3::text is null then now() else last_synced_at end,
            last_error = $3 where user_id = $1 and channel_id = $2`,
    [userId, channelId, error]
  ).catch(() => {});
}

// ----------------------------------------------------------- analytics ----

/** Metrics the owner can see per video per day. Names are the API's. */
export const DAILY_METRICS = [
  'views', 'engagedViews', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage',
  'likes', 'dislikes', 'comments', 'shares', 'subscribersGained', 'subscribersLost',
] as const;

export interface DailyRow {
  video_id: string; date: string; channel_id?: string | null;
  views: number; engaged_views: number | null; estimated_minutes_watched: number; average_view_duration: number;
  average_view_percentage: number; likes: number; dislikes: number; comments: number; shares: number;
  subscribers_gained: number; subscribers_lost: number;
}

/** Map a reports response (columnHeaders + rows) to DailyRow[]; pure. */
export function parseDailyRows(resp: { columnHeaders?: { name: string }[]; rows?: (string | number)[][] }): DailyRow[] {
  const cols = (resp.columnHeaders || []).map((c) => c.name);
  const idx = (n: string) => cols.indexOf(n);
  const iv = idx('video'), id = idx('day');
  if (iv < 0 || id < 0) return [];
  const num = (row: (string | number)[], n: string, dflt: number | null = 0) => {
    const i = idx(n); if (i < 0) return dflt; const v = Number(row[i]); return Number.isFinite(v) ? v : dflt;
  };
  return (resp.rows || []).map((r) => ({
    video_id: String(r[iv]), date: String(r[id]),
    views: num(r, 'views') ?? 0,
    engaged_views: num(r, 'engagedViews', null),
    estimated_minutes_watched: num(r, 'estimatedMinutesWatched') ?? 0,
    average_view_duration: num(r, 'averageViewDuration') ?? 0,
    average_view_percentage: num(r, 'averageViewPercentage') ?? 0,
    likes: num(r, 'likes') ?? 0, dislikes: num(r, 'dislikes') ?? 0, comments: num(r, 'comments') ?? 0,
    shares: num(r, 'shares') ?? 0, subscribers_gained: num(r, 'subscribersGained') ?? 0, subscribers_lost: num(r, 'subscribersLost') ?? 0,
  }));
}

/** The API caps a report at 10,000 rows and 500s on startIndex past it, so callers keep videos x days below this. */
export const REPORT_ROW_CAP = 10000;

/** How many videos fit in one call for a window of `days` days, with headroom. */
export function videosPerCall(days: number): number {
  return Math.max(1, Math.min(200, Math.floor((REPORT_ROW_CAP * 0.9) / (days + 1))));
}

/** Analytics API: per-video per-day metrics for a set of videos in a date window. */
export async function fetchDaily(accessToken: string, videoIds: string[], startDate: string, endDate: string): Promise<DailyRow[]> {
  if (!videoIds.length) return [];
  const u = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
  u.searchParams.set('ids', 'channel==MINE');
  u.searchParams.set('startDate', startDate);
  u.searchParams.set('endDate', endDate);
  u.searchParams.set('metrics', DAILY_METRICS.join(','));
  u.searchParams.set('dimensions', 'video,day');
  u.searchParams.set('filters', `video==${videoIds.join(',')}`);
  u.searchParams.set('maxResults', String(REPORT_ROW_CAP));
  u.searchParams.set('sort', 'day');
  const res = await fetch(u, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30000) });
  const d = await res.json();
  if (!res.ok) throw new Error(`analytics ${res.status}: ${d.error?.message || ''}`);
  const rows = parseDailyRows(d);
  if (rows.length >= REPORT_ROW_CAP) throw new Error(`report truncated at ${REPORT_ROW_CAP} rows; use fewer videos per call`);
  return rows;
}

/** Upsert into daily_analytics (unique video_id, date), in batches under Postgres's parameter cap. */
export const SAVE_BATCH = 500;
export async function saveDaily(rows: DailyRow[], channelId?: string): Promise<number> {
  if (!rows.length) return 0;
  const cols = ['video_id','date','channel_id','views','engaged_views','estimated_minutes_watched','average_view_duration','average_view_percentage','likes','dislikes','comments','shares','subscribers_gained','subscribers_lost'] as const;
  for (let b = 0; b < rows.length; b += SAVE_BATCH) {
    const batch = rows.slice(b, b + SAVE_BATCH);
    const values: any[] = []; const tuples: string[] = [];
    batch.forEach((r, i) => {
      tuples.push(`(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(',')})`);
      for (const c of cols) values.push(c === 'channel_id' ? (r.channel_id ?? channelId ?? null) : (r as any)[c]);
    });
    await q(
      `insert into daily_analytics (${cols.join(',')}) values ${tuples.join(',')}
       on conflict (video_id, date) do update set
         ${cols.filter((c) => c !== 'video_id' && c !== 'date').map((c) => `${c} = excluded.${c}`).join(', ')}, updated_at = now()`,
      values
    );
  }
  return rows.length;
}
