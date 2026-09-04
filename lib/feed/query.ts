// Reading the feed. Keyset pagination on (at desc, id desc) — offsets drift as the materializer
// inserts underneath a scrolling reader, and get slower the further down you go.
import { q } from '../admin/db';
import { FEED_TYPES } from './event-types';

export { FEED_TYPES };
export type { FeedEventType } from './event-types';

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
  /** The video's current view count — the TestRow's "2.3M views" line. */
  view_count: number | null;
  payload: Record<string, unknown>;
  /**
   * The video's current video_scores.score. An outlier event's payload freezes the score at
   * the moment the video crossed 2x, and the channel baseline is refit under it afterwards,
   * so the card would otherwise keep quoting a number the video page contradicts.
   */
  score: number | null;
  /** Why there is no score, when there is none (lib/scoring/score-gaps.ts names the causes). */
  score_n_baseline: number | null;
  score_confidence: string | null;
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
  /** Only events at or after this ISO timestamp (polling clients). */
  since?: string | null;
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


export function normalizeTypes(types: string[] | null | undefined): string[] | null {
  if (!types || !types.length) return null;
  const wanted = types.map((t) => t.trim()).filter((t) => FEED_TYPES.includes(t));
  return wanted.length ? [...new Set(wanted)] : null;
}



/**
 * One page of events for an explicit channel list. `feedFor` layers the user's tracked channels
 * on top of this; the public API uses it directly.
 */
export async function feedForChannels(channelIds: string[], opts: FeedOptions = {}): Promise<FeedPage> {
  if (!channelIds.length) return { events: [], next_cursor: null };
  const limit = clampLimit(opts.limit);
  const cursor = decodeCursor(opts.cursor);
  const types = normalizeTypes(opts.types);

  // Per-channel top-N, then merge. One index scan per tracked channel on
  // idx_feed_events_channel_at_longform reads at most `limit + 1` rows in index order; the
  // outer sort picks the global page out of those. The flat form scanned the global
  // (at desc) index and threw away every event belonging to an untracked channel — 32K rows
  // discarded to produce 60 on a 19-channel account.
  //
  // The longform test is a stored column (feed_events.is_longform, written at insert time and
  // maintained by the shorts verifier) rather than a join to videos: joining 4,266 events to
  // videos before the LIMIT was the other half of the cost. videos is still LEFT JOINed for
  // the display columns, but now for the page's 60 rows only.
  const p = { channels: 1, limit: 2, cursorAt: 3, cursorId: 4 };
  let n = cursor ? 5 : 3;
  const typesParam = types ? n++ : 0;
  const sinceParam = opts.since ? n++ : 0;
  const inner = `select e2.id, e2.type, e2.at, e2.channel_id, e2.video_id, e2.payload
                   from feed_events e2
                  where e2.channel_id = c.channel_id
                    and e2.is_longform
                    ${cursor ? `and (e2.at, e2.id) < ($${p.cursorAt}::timestamptz, $${p.cursorId}::bigint)` : ''}
                    ${types ? `and e2.type = any($${typesParam}::text[])` : ''}
                    ${opts.since ? `and e2.at >= $${sinceParam}::timestamptz` : ''}
                  order by e2.at desc, e2.id desc
                  limit $${p.limit}`;

  // One extra row tells us whether another page exists without a second count query.
  const rows = await q<FeedRow>(
    `select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.payload,
            v.title as video_title, v.thumbnail_url, v.channel_name, v.published_at, v.view_count,
            sc.score::float8 as score, sc.n_baseline as score_n_baseline, sc.confidence as score_confidence,
            sc.est30::float8 as score_est30, sc.baseline::float8 as score_baseline,
            sc.typical_at_age::float8 as score_typical_at_age
       from (
         select x.*
           from unnest($${p.channels}::text[]) as c(channel_id)
           cross join lateral (${inner}) x
          order by x.at desc, x.id desc
          limit $${p.limit}
       ) e
       left join videos v on v.id = e.video_id
       left join video_scores sc on sc.video_id = e.video_id
      order by e.at desc, e.id desc`,
    [
      channelIds,
      limit + 1,
      ...(cursor ? [cursor.at, cursor.id] : []),
      ...(types ? [types] : []),
      ...(opts.since ? [opts.since] : []),
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
