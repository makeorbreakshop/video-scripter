// Reading the feed. Keyset pagination on (at desc, id desc) — offsets drift as the materializer
// inserts underneath a scrolling reader, and get slower the further down you go.
import { q } from '../admin/db';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface FeedRow {
  id: string;
  type: string;
  at: string;
  channel_id: string | null;
  channel_name: string | null;
  video_id: string | null;
  video_title: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  payload: Record<string, unknown>;
}

export interface FeedPage {
  events: FeedRow[];
  next_cursor: string | null;
}

export interface FeedOptions {
  cursor?: string | null;
  limit?: number;
  /** Restrict to these event types; empty or omitted means all. */
  types?: string[] | null;
}

export interface Cursor { at: string; id: string }

/** Opaque to callers, but deliberately readable in logs: "<iso>|<id>", base64url. */
export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.at}|${c.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const sep = text.lastIndexOf('|');
  if (sep <= 0) return null;
  const at = text.slice(0, sep);
  const id = text.slice(sep + 1);
  if (Number.isNaN(Date.parse(at)) || !/^\d+$/.test(id)) return null;
  return { at, id };
}

export function clampLimit(limit: number | undefined | null): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

/** Types the feed knows about; anything else is dropped rather than passed to the query. */
export const FEED_TYPES = ['upload', 'thumbnail_change', 'ab_rotation', 'title_change', 'outlier'];

export function normalizeTypes(types: string[] | null | undefined): string[] | null {
  if (!types || !types.length) return null;
  const wanted = types.map((t) => t.trim()).filter((t) => FEED_TYPES.includes(t));
  return wanted.length ? [...new Set(wanted)] : null;
}

const SELECT = `
  select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.payload,
         v.title as video_title, v.thumbnail_url, v.channel_name, v.published_at
    from feed_events e
    left join videos v on v.id = e.video_id`;

/**
 * One page of events for an explicit channel list. `feedFor` layers the user's tracked channels
 * on top of this; the public API uses it directly.
 */
export async function feedForChannels(channelIds: string[], opts: FeedOptions = {}): Promise<FeedPage> {
  if (!channelIds.length) return { events: [], next_cursor: null };
  const limit = clampLimit(opts.limit);
  const cursor = decodeCursor(opts.cursor);
  const types = normalizeTypes(opts.types);

  // One extra row tells us whether another page exists without a second count query.
  const rows = await q<FeedRow>(
    `${SELECT}
      where e.channel_id = any($1)
        ${cursor ? `and (e.at, e.id) < ($3::timestamptz, $4::bigint)` : ''}
        ${types ? `and e.type = any($${cursor ? 5 : 3}::text[])` : ''}
      order by e.at desc, e.id desc
      limit $2`,
    [
      channelIds,
      limit + 1,
      ...(cursor ? [cursor.at, cursor.id] : []),
      ...(types ? [types] : []),
    ]
  );

  const events = rows.slice(0, limit);
  const last = events[events.length - 1];
  return {
    events,
    next_cursor: rows.length > limit && last ? encodeCursor({ at: new Date(last.at).toISOString(), id: last.id }) : null,
  };
}

/** The signed-in user's feed: events across every channel in their user_channels. */
export async function feedFor(userId: string, opts: FeedOptions = {}): Promise<FeedPage> {
  const channels = await q<{ channel_id: string }>(
    `select channel_id from user_channels where user_id = $1`,
    [userId]
  );
  return feedForChannels(channels.map((c) => c.channel_id), opts);
}
