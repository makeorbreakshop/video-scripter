// Reading the feed. Keyset pagination on (at desc, id desc) — offsets drift as the materializer
// inserts underneath a scrolling reader, and get slower the further down you go.
import { q } from '../admin/db';
import { FEED_TYPES, DENSE_FEED_TYPES } from './event-types';

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
 * Above this many channels, one walk down the global (at desc, id desc) index reaches a
 * 60-row page with less IO than one index probe per channel. Below it, the probes win — and
 * win by a lot, because a small tracked set is sparse in the recent global window.
 * See docs/perf/2026-09-04-feed-speed-audit.md for the measured curves.
 */
export const FLAT_SCAN_MIN_CHANNELS = 300;

/**
 * Which shape of scan to use. Pure, so the choice is testable without a database.
 *
 * `lateral` probes idx_feed_events_channel_type_at_longform once per channel: it reads
 * min(limit, that channel's events of that type) entries, which is bounded and tiny for a
 * sparse segment but degenerates to n × limit for a dense one.
 *
 * `flat` walks idx_feed_events_at_id once and discards untracked channels as it goes: cheap
 * only when the tracked set fills a page from the recent window quickly, which needs both a
 * large channel set and a segment that is not rare.
 *
 * Measured for the 500-channel account, buffers read for a 60-row page:
 *
 *   segment    lateral   flat
 *   all         12,728   1,331   -> flat
 *   uploads     20,125   2,309   -> flat
 *   outliers     1,707  13,016   -> lateral
 *   tests        3,040   3,040   -> either
 *   changes      4,552   4,552   -> either
 */
export function scanShape(channelCount: number, types: string[] | null | undefined): 'lateral' | 'flat' {
  if (channelCount < FLAT_SCAN_MIN_CHANNELS) return 'lateral';
  if (!types || !types.length) return 'flat';
  return types.some((t) => DENSE_FEED_TYPES.includes(t)) ? 'flat' : 'lateral';
}

/**
 * One page of events for an explicit channel list. `feedFor` layers the user's tracked channels
 * on top of this; the public API uses it directly.
 *
 * Keyset paginated on (at desc, id desc): offsets drift as the materializer inserts underneath
 * a scrolling reader, and get slower the further down you go.
 *
 * The longform test is a stored column (feed_events.is_longform, written at insert time and
 * maintained by the shorts verifier) rather than a join to videos: joining thousands of events
 * to videos before the LIMIT was expensive. videos is still LEFT JOINed for the display
 * columns, but for the page's 60 rows only.
 */
export async function feedForChannels(channelIds: string[], opts: FeedOptions = {}): Promise<FeedPage> {
  if (!channelIds.length) return { events: [], next_cursor: null };
  const limit = clampLimit(opts.limit);
  const cursor = decodeCursor(opts.cursor);
  const types = normalizeTypes(opts.types);
  const shape = scanShape(channelIds.length, types);

  const p = { channels: 1, limit: 2, cursorAt: 3, cursorId: 4 };
  let n = cursor ? 5 : 3;
  const typesParam = types ? n++ : 0;
  const sinceParam = opts.since ? n++ : 0;

  // The predicate is the same either way; only how it is reached differs.
  const where = (t: string) => `${t}.is_longform
                    ${cursor ? `and (${t}.at, ${t}.id) < ($${p.cursorAt}::timestamptz, $${p.cursorId}::bigint)` : ''}
                    ${types ? `and ${t}.type = any($${typesParam}::text[])` : ''}
                    ${opts.since ? `and ${t}.at >= $${sinceParam}::timestamptz` : ''}`;

  // Per-channel top-N, then merge. One index scan per tracked channel on
  // idx_feed_events_channel_at_longform reads at most `limit + 1` rows in index order; the
  // outer sort picks the global page out of those.
  const lateral = `select x.*
       from unnest($${p.channels}::text[]) as c(channel_id)
       cross join lateral (
         select e2.id, e2.type, e2.at, e2.channel_id, e2.video_id, e2.payload
           from feed_events e2
          where e2.channel_id = c.channel_id
            and ${where('e2')}
          order by e2.at desc, e2.id desc
          limit $${p.limit}
       ) x
      order by x.at desc, x.id desc
      limit $${p.limit}`;

  // One walk down the global (at desc, id desc) index, discarding untracked channels as it
  // goes. At 500 channels the page fills within the first couple of thousand entries, which
  // is an order of magnitude less IO than 500 separate probes.
  const flat = `select e0.id, e0.type, e0.at, e0.channel_id, e0.video_id, e0.payload
       from feed_events e0
      where e0.channel_id = any($${p.channels}::text[])
        and ${where('e0')}
      order by e0.at desc, e0.id desc
      limit $${p.limit}`;

  // One extra row tells us whether another page exists without a second count query.
  const rows = await q<FeedRow>(
    `select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.payload,
            v.title as video_title, v.thumbnail_url, v.channel_name, v.published_at, v.view_count,
            sc.score::float8 as score, sc.n_baseline as score_n_baseline, sc.confidence as score_confidence,
            sc.est30::float8 as score_est30, sc.baseline::float8 as score_baseline,
            sc.typical_at_age::float8 as score_typical_at_age
       from (${shape === 'flat' ? flat : lateral}) e
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
