// /app/outliers — guarded outlier videos, filtered by how close the SOURCE channel sits to the
// owner's own channel in the identity space (lib/semantic/channel-relations.ts).
//
// Three buckets, one query each. `near` and `adjacent` are id lists, so Postgres drives off
// idx_videos_channel_published_longform (one index scan per channel, ~70 of them) and probes
// video_scores by primary key. `far` is the complement, so it drives off the score guard
// (idx_video_scores_score) or the published index and probes videos by id — no sequential scan
// on either table in any of the six sort/bucket combinations. See the EXPLAIN notes below.
//
// Direct Postgres only (lib/admin/db.ts) — never supabase-js (2026-08-31 org-wide egress incident).
import { q } from '../admin/db';
import { longformSql } from '../scoring/longform';
import { versionThumbUrl } from './video-page';
import { channelRelations, type ChannelRelations } from '../semantic/channel-relations';
import type { GridVideo } from './channel-page';
import {
  OUTLIER_PAGE, RANGE_DAYS, DEFAULT_MIN, DEFAULT_CONF, DEFAULT_FLOOR,
  type OutlierSort, type OutlierRange, type Confidence, type MinMultiple, type Floor,
} from './outliers-url';

export * from './outliers-url';

// Qdrant holds 6,400 channel vectors and the neighbour query pulls 2,000 of them; the answer only
// changes when the collection is rebuilt, so one anchor's relations are cached for an hour rather
// than re-queried on every page view and every "more".
const RELATIONS_TTL_MS = 60 * 60 * 1000;
const relationsCache = new Map<string, { at: number; value: ChannelRelations | null }>();

/** null when the anchor has no identity vector (or Qdrant is down): the page renders without buckets. */
export async function cachedRelations(anchor: string): Promise<ChannelRelations | null> {
  const hit = relationsCache.get(anchor);
  if (hit && Date.now() - hit.at < RELATIONS_TTL_MS) return hit.value;
  let value: ChannelRelations | null = null;
  try {
    value = await channelRelations(anchor, { limit: 2_000 });
  } catch (e) {
    console.error('outliers: channelRelations', (e as Error)?.message);
    value = null;
  }
  relationsCache.set(anchor, { at: Date.now(), value });
  return value;
}

/** Test seam: drop a cached anchor. */
export function clearRelationsCache(): void {
  relationsCache.clear();
}

const SORTS: Record<OutlierSort, string> = {
  score: 's.score desc nulls last, v.published_at desc nulls last',
  published: 'v.published_at desc nulls last',
};

export interface OutlierRow extends GridVideo {
  channel_id: string;
  channel_name: string;
}

/** The quality guards, as the page passes them to Postgres. */
export interface Guards {
  min: MinMultiple;
  conf: Confidence[];
  floor: Floor;
}

export const DEFAULT_GUARDS: Guards = { min: DEFAULT_MIN, conf: DEFAULT_CONF, floor: DEFAULT_FLOOR };

/**
 * The guard, as one WHERE fragment with bound parameters — never interpolated text.
 *
 * `n_baseline >= 5` is fixed rather than a control: below five videos the channel baseline is
 * not a distribution, it is a couple of numbers, so a "10x" off it says nothing about the
 * channel. The other three move because they are editorial, not statistical — how big a win
 * counts, how settled the reading has to be, and how small an audience still counts as one.
 */
const guardSql = (n: number) => `and s.score >= $${n}::numeric
          and s.confidence = any($${n + 1}::text[])
          and s.n_baseline >= 5
          and s.baseline >= $${n + 2}::bigint`;

const guardParams = (g: Guards) => [g.min, g.conf, g.floor];

/**
 * One page of guarded outliers from a bucket.
 *
 * video_scores is keyed on video_id, so "the latest row per video" is the row.
 *
 * EXPLAIN (ANALYZE, BUFFERS), 2026-09-15, 69 near ids / 346 excluded ids, 30d, limit 61, at the
 * defaults (score >= 2, confirmed|likely, baseline >= 500):
 *   near  + score     Index Scan idx_videos_channel_published_longform → pkey probes, ~250 ms warm
 *   far   + score     Parallel Index Scan idx_video_scores_score → videos_pkey probes, ~90 ms warm
 * No sequential scan on videos or video_scores. Dropping the baseline floor from 5000 to 500
 * does not change either plan shape — the floor was never the driving condition.
 */
export async function outlierPage(opts: {
  ids: string[];
  mode: 'include' | 'exclude';
  sort: OutlierSort;
  range: OutlierRange;
  guards?: Guards;
  limit?: number;
  offset?: number;
}): Promise<{ videos: OutlierRow[]; hasMore: boolean }> {
  const limit = opts.limit ?? OUTLIER_PAGE;
  const offset = opts.offset ?? 0;
  const guards = opts.guards ?? DEFAULT_GUARDS;
  if (opts.mode === 'include' && opts.ids.length === 0) return { videos: [], hasMore: false };

  const rows = await q<any>(
    `select v.id, v.title, v.channel_id,
            coalesce(cm.title, v.channel_name, v.channel_id) as channel_name,
            v.published_at, v.view_count, v.thumbnail_url, s.score
       from videos v
       join video_scores s on s.video_id = v.id
       left join channel_meta cm on cm.channel_id = v.channel_id
      where ${channelClause(opts.mode)}
        and v.published_at >= now() - ($2::int * interval '1 day')
        and ${longformSql('v')}
        and coalesce(v.is_institutional, false) = false
        ${guardSql(5)}
      order by ${SORTS[opts.sort]}
      limit $3 offset $4`,
    [opts.ids, RANGE_DAYS[opts.range], limit + 1, offset, ...guardParams(guards)]
  );

  const hasMore = rows.length > limit;
  return {
    hasMore,
    videos: rows.slice(0, limit).map((r) => ({
      id: r.id,
      title: r.title,
      channel_id: r.channel_id,
      channel_name: r.channel_name,
      published_at: new Date(r.published_at).toISOString(),
      view_count: Number(r.view_count ?? 0),
      score: r.score != null ? Number(r.score) : null,
      confidence: null,
      swaps: 0,
      last_change: null,
      thumb_latest: null,
      thumb_prev: null,
      title_latest: null,
      title_prev: null,
      thumbUrl: r.thumbnail_url || versionThumbUrl(r.id, 1),
      prevThumbUrl: null,
    })),
  };
}

function channelClause(mode: 'include' | 'exclude'): string {
  return mode === 'include'
    ? 'v.channel_id = any($1::text[])'
    : 'v.channel_id is not null and v.channel_id <> all($1::text[])';
}

/** How many rows the heading says, capped so the count can never become an unbounded read. */
export const OUTLIER_COUNT_CAP = 1_000;

/**
 * The same predicate as `outlierPage`, counted. Bounded by a LIMIT inside the subquery: past the
 * cap the page says "1000+" rather than making Postgres walk a whole bucket to say a number
 * nobody reads. No ORDER BY here — the count does not care which rows they are.
 */
export async function outlierCount(opts: {
  ids: string[];
  mode: 'include' | 'exclude';
  range: OutlierRange;
  guards?: Guards;
}): Promise<{ n: number; capped: boolean }> {
  const guards = opts.guards ?? DEFAULT_GUARDS;
  if (opts.mode === 'include' && opts.ids.length === 0) return { n: 0, capped: false };
  const rows = await q<{ n: string }>(
    `select count(*)::bigint as n from (
       select 1
         from videos v
         join video_scores s on s.video_id = v.id
        where ${channelClause(opts.mode)}
          and v.published_at >= now() - ($2::int * interval '1 day')
          and ${longformSql('v')}
          and coalesce(v.is_institutional, false) = false
          ${guardSql(4)}
        limit $3
     ) t`,
    [opts.ids, RANGE_DAYS[opts.range], OUTLIER_COUNT_CAP, ...guardParams(guards)]
  );
  const n = Number(rows[0]?.n ?? 0);
  return { n, capped: n >= OUTLIER_COUNT_CAP };
}
