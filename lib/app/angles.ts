// /app/angles — the packaging angle board. Which framings are winning near the owner's channel,
// which are winning next door and have never been tried here, and the videos that prove it.
//
// An angle is the framing of a subject in the packaging (title + thumbnail), independent of the
// subject and of the spoken hook. Labels come from a closed enum (scripts/angles/) and live in
// video_angles; this module only reads them.
//
// Buckets are the same three /app/outliers uses — near / adjacent / far, by how close the SOURCE
// channel sits to the anchor in the identity space — but "far" here is a BAND, the few hundred
// channels ranked just past the adjacent cutoff, not the rest of the corpus. The three lists are
// passed in as one ranked array, so one pass over the pool answers for all three at once and
// example ordering is that array's own order.
//
// Direct Postgres only (lib/admin/db.ts) — never supabase-js (2026-08-31 org-wide egress incident).
import { q } from '../admin/db';
import { longformSql } from '../scoring/longform';
import { creatorLikenessFloor } from '../semantic/creator-likeness';
import { cachedRelations } from './outliers';
import {
  ANGLE_PAGE, ANGLE_RANGE_DAYS, BOARD_EXAMPLES, BOARD_EXAMPLE_HEADROOM, DEFAULT_MIN_MULTIPLE,
  EXAMPLE_MAX_SCORE, EXAMPLES_PER_CHANNEL_PER_ANGLE, capChannelsAcrossBoard, channelBand,
  groupByFamily, unusedNear,
  type AngleBucket, type AngleExample, type AngleFamilySection, type AngleRange, type AngleStat,
  type BandChannel, type DetailSort,
} from './angles-url';

export * from './angles-url';
export { cachedRelations };

// ------------------------------------------------------------------ shapes

export interface AngleBoard {
  /** Distinct videos behind the board, not label rows. */
  tagged: number;
  families: AngleFamilySection[];
  /** Winning next door, never tried here. */
  unusedNear: AngleStat[];
  relations: Awaited<ReturnType<typeof cachedRelations>>;
  /**
   * Channels actually read, per bucket — after the creator-likeness floor and the far-band cut.
   * The bucket chips count these, not the raw neighbour lists: a chip that says 69 near when the
   * board read 61 of them is off by the exact thing this page changed.
   */
  band: { near: number; adjacent: number; far: number };
}

// ------------------------------------------------------------------ the shared pool

/**
 * The packaged, guarded pool, restricted to the anchor's distance band.
 *
 * `$1` channel ids and `$2` their buckets are two parallel arrays in priority order — near
 * (closest first), then adjacent, then the far band — so `with ordinality` hands every row both
 * its bucket and its rank in one join, and "prefer near, then adjacent, then the closest
 * strangers" is an ORDER BY on one integer.
 *
 * Two things this pool is NOT any more, and both were the reason the board filled with Euro-disco
 * megamixes and NFL recaps:
 *
 *   far is a band, not a complement. It used to mean "every channel in the corpus that is not a
 *   neighbour", which is 1.1M videos of everything, and a draw from it is a draw from YouTube.
 *   It now means the ~600 channels ranked immediately past the adjacent cutoff — the nearest
 *   strangers. Channels below the creator_likeness floor are already gone from the arrays
 *   (channelBand), so no channel filter appears in SQL at all.
 *
 *   unpackaged rows are excluded. A music mix has no angle; the tagger now says so and
 *   video_packaging records it. The join is inner, so a video the tagger has never seen is also
 *   out — the board only shows what has actually been judged.
 *
 * video_angles stays the driving table: it is two orders of magnitude smaller than videos, and
 * the band is a hash of a few thousand ids probed against it.
 */
/**
 * The pool's channel gate, as an array membership test rather than a join.
 *
 * The band arrived as a CTE joined on channel_id and the planner nested-looped it: it estimated
 * one outer row, rescanned all 945 band rows for each of 4,889, and threw away 4.6M pairs —
 * 985 ms of a 1,060 ms statement. `= any($1)` is a hashed ScalarArrayOp instead, and the rank is
 * read back with array_position over the same array (945 x 1,661 comparisons, immeasurable).
 *
 * That works only because the array is already in priority order — near, then adjacent, then the
 * far band, each closest-first — so a position IS a rank and the two boundary counts are the
 * whole bucket definition. channelBand() guarantees that order; `bandParams` carries the
 * boundaries beside it.
 */
const CHANNEL_RANK_SQL = `
  cross join lateral (select array_position($1::text[], v.channel_id) as channel_rank) r`;

const BUCKET_SQL = `
  case when r.channel_rank <= $2::int then 'near'
       when r.channel_rank <= $2::int + $3::int then 'adjacent'
       else 'far' end`;

/**
 * The packaged, guarded pool, restricted to the anchor's distance band.
 *
 * Two things this pool is NOT any more, and both were the reason the board filled with Euro-disco
 * megamixes and NFL recaps:
 *
 *   far is a band, not a complement. It used to mean "every channel in the corpus that is not a
 *   neighbour", which is 1.1M videos of everything, and a draw from it is a draw from YouTube.
 *   It now means the ~600 channels ranked immediately past the adjacent cutoff — the nearest
 *   strangers. Measured against Make or Break Shop's anchor, every channel that embarrassed the
 *   old board (Euro Disco, NFL, Disney Jr., ESPN, Basair TV, CookieSwirlC) ranks beyond 2,000 in
 *   the identity list, so the band cut alone removes all of them.
 *
 *   unpackaged rows are excluded. A music mix has no angle; the tagger now says so and
 *   video_packaging records it. The join is inner, so a video the tagger has never seen is also
 *   out — the board only shows what has actually been judged.
 */
/**
 * v1 and v3 rows now live in the same table (see 20260917120000_angles_v3.sql), and only one
 * vocabulary can be on the board at a time. It is the one `angles.active` names.
 */
export const ACTIVE_TAXONOMY_VERSION = 3;

const POOL_SQL = `
    select va.angle_id, va.variation, v.id, v.title, v.channel_id, v.thumbnail_url,
           v.published_at, v.view_count,
           coalesce(cm.title, v.channel_name, v.channel_id) as channel_name,
           s.score, ${BUCKET_SQL} as bucket, r.channel_rank::int as channel_rank
      from video_angles va
      join videos v on v.id = va.video_id
      join video_scores s on s.video_id = v.id
      join video_packaging p on p.video_id = va.video_id and p.unpackaged = false
      left join channel_meta cm on cm.channel_id = v.channel_id
      ${CHANNEL_RANK_SQL}
     where va.taxonomy_version = ${ACTIVE_TAXONOMY_VERSION}
       and v.channel_id = any($1::text[])
       and v.published_at >= now() - ($4::int * interval '1 day')
       and s.score >= $5::numeric
       and s.confidence = any(array['confirmed','likely']::text[])
       and s.n_baseline >= 5
       and s.baseline >= 500
       and ${longformSql('v')}
       and coalesce(v.is_institutional, false) = false`;

/** `all` is not a filter, it is the absence of one. */
const bucketFilter = (bucket: AngleBucket, n: number) =>
  bucket === 'all' ? '' : `and bucket = $${n}`;

/**
 * The anchor's band, with the channels that do not look like the channels people track removed.
 *
 * The floor comes from lib/semantic/creator-likeness.json — the 5th percentile of the tracked
 * set's own likeness. Null (the script has never run) means no filtering rather than an empty
 * board.
 */
async function band(anchorChannelId: string | null): Promise<{ relations: Awaited<ReturnType<typeof cachedRelations>>; band: BandChannel[] }> {
  const relations = anchorChannelId ? await cachedRelations(anchorChannelId) : null;
  return { relations, band: channelBand(relations, { floor: creatorLikenessFloor()?.floor ?? null }) };
}

/** The band as the pool's first three parameters: ids in rank order, then the two boundaries. */
const bandParams = (channels: BandChannel[]) =>
  [
    channels.map((c) => c.channel_id),
    channels.filter((c) => c.bucket === 'near').length,
    channels.filter((c) => c.bucket === 'adjacent').length,
  ] as const;

// ------------------------------------------------------------------ the board

/**
 * The two board statements, as named strings rather than inline template literals, so the
 * EXPLAIN harness runs the exact text the page runs and cannot drift from it.
 */
export const boardStatsSql = (bucket: AngleBucket) => `
  with pool as (${POOL_SQL})
  select angle_id,
         count(*)::int as n,
         count(distinct id)::int as videos,
         percentile_cont(0.5) within group (order by score) as median,
         count(*) filter (where bucket = 'near')::int as n_near,
         count(*) filter (where bucket = 'adjacent')::int as n_adjacent,
         count(*) filter (where bucket = 'far')::int as n_far
    from pool
   where true ${bucketFilter(bucket, 6)}
   group by grouping sets ((angle_id), ())`;

/**
 * One tile per channel per angle (its best video), then straight down the band: the closest
 * channels that used this angle, near before adjacent before far. `channel_rank` is the band
 * array's own ordinality, so the ordering rule lives in channelBand() and this is just an
 * ORDER BY on an integer.
 *
 * Examples are capped at EXAMPLE_MAX_SCORE — see the constant; the stats above still count
 * those rows. Rows are fetched with headroom because capChannelsAcrossBoard can delete tiles
 * afterwards.
 */
export const boardExamplesSql = (bucket: AngleBucket) => `
  with pool as (${POOL_SQL}),
  filtered as (select * from pool
                where score <= $6::numeric ${bucketFilter(bucket, 9)}),
  one_per_channel as (
    select *, row_number() over (partition by angle_id, channel_id order by score desc nulls last) as rn_ch
      from filtered
  ),
  ranked as (
    select *, row_number() over (partition by angle_id order by channel_rank, score desc nulls last) as rn
      from one_per_channel where rn_ch <= $7::int
  )
  select angle_id, id, title, channel_id, channel_name, bucket, score, thumbnail_url,
         variation, published_at, view_count
    from ranked where rn <= $8::int
   order by angle_id, rn`;


export interface BoardOptions {
  range: AngleRange;
  bucket?: AngleBucket;
  family?: string | null;
  minMultiple?: number;
}

/**
 * Stats and examples for every angle, in two bounded queries.
 *
 * EXPLAIN (ANALYZE, BUFFERS), 2026-09-16, Make or Break Shop anchor, 945-channel band, 90d,
 * defaults, warm:
 *   stats     Seq Scan video_packaging (1,661 packaged rows, 42 pages) → videos_pkey →
 *             video_angles_pkey → video_scores_pkey, GroupAggregate over two grouping sets.
 *             46 ms, 102 rows — 101 angles plus the keyless row, the board's distinct-video total.
 *   examples  the same nested loop, then two WindowAggs and a sort. 96 ms.
 * No sequential scan on videos or video_scores in either. video_packaging is the driving table
 * because it is now the smallest thing in the join and carries the `unpackaged = false` filter;
 * at 42 pages a scan of it is cheaper than any index.
 *
 * The 945-element band is a hashed `= any()` and the rank an array_position over the same array;
 * as a joined CTE the planner nested-looped it and spent 985 ms discarding 4.6M pairs. See
 * CHANNEL_RANK_SQL.
 */
export async function angleBoard(
  anchorChannelId: string | null,
  opts: BoardOptions
): Promise<AngleBoard> {
  const key = JSON.stringify([anchorChannelId, opts]);
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.at < BOARD_TTL_MS) return hit.value;

  const { relations, band: channels } = await band(anchorChannelId);
  const bucket = opts.bucket ?? 'all';
  const base = [...bandParams(channels), ANGLE_RANGE_DAYS[opts.range], opts.minMultiple ?? DEFAULT_MIN_MULTIPLE];

  const [stats, examples] = await Promise.all([
    q<any>(boardStatsSql(bucket), bucket === 'all' ? base : [...base, bucket]),
    q<any>(
      boardExamplesSql(bucket),
      bucket === 'all'
        ? [...base, EXAMPLE_MAX_SCORE, EXAMPLES_PER_CHANNEL_PER_ANGLE, BOARD_EXAMPLE_HEADROOM]
        : [...base, EXAMPLE_MAX_SCORE, EXAMPLES_PER_CHANNEL_PER_ANGLE, BOARD_EXAMPLE_HEADROOM, bucket]
    ),
  ]);

  const taxonomy = await angleTaxonomy();
  const byAngle = new Map<string, AngleExample[]>();
  for (const r of examples) {
    const list = byAngle.get(r.angle_id) ?? [];
    list.push(toExample(r));
    byAngle.set(r.angle_id, list);
  }

  // The grouping set with no key is the grand total: distinct videos, not label rows. A video
  // carries two or three angles, so summing n would say 13,372 where the corpus is 4,809.
  const tagged = Number(stats.find((s: any) => s.angle_id == null)?.videos ?? 0);

  const rows: AngleStat[] = stats
    .filter((s: any) => s.angle_id != null)
    .map((s: any): AngleStat | null => {
      const t = taxonomy.get(s.angle_id);
      if (!t) return null; // tagged against an id that has since left the enum
      return {
        angle_id: s.angle_id,
        label: t.label,
        definition: t.definition,
        kind: t.kind,
        family_id: t.family_id,
        family_label: t.family_label,
        family_position: t.family_position,
        n: Number(s.n),
        median: s.median != null ? Number(s.median) : null,
        n_near: Number(s.n_near),
        n_adjacent: Number(s.n_adjacent),
        n_far: Number(s.n_far),
        examples: byAngle.get(s.angle_id) ?? [],
      };
    })
    .filter((r): r is AngleStat => r !== null)
    .filter((r) => !opts.family || r.family_id === opts.family);

  // The board-wide channel budget is spent in median order, which is the page's default sort —
  // so the angles a reader looks at first are the ones that get the channel they deserve.
  const capped = capChannelsAcrossBoard(
    [...rows].sort((a, b) => (b.median ?? 0) - (a.median ?? 0)),
    BOARD_EXAMPLES,
  );
  const byId = new Map(capped.map((r) => [r.angle_id, r]));

  const value: AngleBoard = {
    tagged,
    band: {
      near: channels.filter((c) => c.bucket === 'near').length,
      adjacent: channels.filter((c) => c.bucket === 'adjacent').length,
      far: channels.filter((c) => c.bucket === 'far').length,
    },
    families: groupByFamily(rows.map((r) => byId.get(r.angle_id) ?? r)),
    unusedNear: unusedNear(rows.map((r) => byId.get(r.angle_id) ?? r)),
    relations,
  };
  boardCache.set(key, { at: Date.now(), value });
  return value;
}

// ------------------------------------------------------------------ one angle

export interface AngleDetail {
  angle: { id: string; label: string; definition: string; family_id: string; family_label: string; kind: 'title' | 'thumbnail' } | null;
  counts: { all: number; near: number; adjacent: number; far: number };
  videos: AngleExample[];
  hasMore: boolean;
}

/**
 * One angle's examples, paged.
 *
 * Same pool, one angle, no per-channel dedupe — the board shows a spread, the detail page shows
 * everything. The bucket counts are their own query so the chips can carry numbers whatever the
 * bucket filter is; both run in one Promise.all.
 *
 * `va.angle_id = $6` is what changes the plan: the board leads with video_packaging, this drives
 * off idx video_angles_angle_tagged and probes out. No sequential scan on videos or video_scores.
 */
export async function angleDetail(
  angleId: string,
  anchorChannelId: string | null,
  opts: { range: AngleRange; bucket: AngleBucket; sort: DetailSort; limit?: number }
): Promise<AngleDetail> {
  const { band: channels } = await band(anchorChannelId);
  const limit = opts.limit ?? ANGLE_PAGE;
  const taxonomy = await angleTaxonomy();
  const t = taxonomy.get(angleId);
  if (!t) return { angle: null, counts: { all: 0, near: 0, adjacent: 0, far: 0 }, videos: [], hasMore: false };

  const base = [...bandParams(channels), ANGLE_RANGE_DAYS[opts.range], DEFAULT_MIN_MULTIPLE, angleId];
  const order = opts.sort === 'published'
    ? 'published_at desc nulls last'
    : 'score desc nulls last, published_at desc nulls last';

  const [counts, videos] = await Promise.all([
    q<any>(
      `with pool as (${POOL_SQL} and va.angle_id = $6::text)
       select count(*)::int as all,
              count(*) filter (where bucket = 'near')::int as near,
              count(*) filter (where bucket = 'adjacent')::int as adjacent,
              count(*) filter (where bucket = 'far')::int as far
         from pool`,
      base
    ),
    q<any>(
      `with pool as (${POOL_SQL} and va.angle_id = $6::text)
       select angle_id, id, title, channel_id, channel_name, bucket, score, thumbnail_url,
              variation, published_at, view_count
         from pool
        where true ${bucketFilter(opts.bucket, 8)}
        order by ${order}
        limit $7::int`,
      opts.bucket === 'all' ? [...base, limit + 1] : [...base, limit + 1, opts.bucket]
    ),
  ]);

  return {
    angle: { id: angleId, label: t.label, definition: t.definition, family_id: t.family_id, family_label: t.family_label, kind: t.kind },
    counts: counts[0] ?? { all: 0, near: 0, adjacent: 0, far: 0 },
    videos: videos.slice(0, limit).map(toExample),
    hasMore: videos.length > limit,
  };
}

// ------------------------------------------------------------------ taxonomy + caches

interface TaxonomyRow {
  label: string; definition: string; kind: 'title' | 'thumbnail';
  family_id: string; family_label: string; family_position: number;
}

const TAXONOMY_TTL_MS = 60 * 60 * 1000;
let taxonomyCache: { at: number; value: Map<string, TaxonomyRow> } | null = null;

/** 153 rows that change when someone edits the enum and re-seeds — an hour is plenty. */
export async function angleTaxonomy(): Promise<Map<string, TaxonomyRow>> {
  if (taxonomyCache && Date.now() - taxonomyCache.at < TAXONOMY_TTL_MS) return taxonomyCache.value;
  const rows = await q<any>(
    `select a.id, a.label, a.definition, a.kind, a.family_id,
            f.label as family_label, f.position as family_position
       from angles a join angle_families f on f.id = a.family_id
      where a.active`
  );
  const value = new Map<string, TaxonomyRow>(
    rows.map((r) => [r.id, {
      label: r.label, definition: r.definition, kind: r.kind, family_id: r.family_id,
      family_label: r.family_label, family_position: Number(r.family_position),
    }])
  );
  taxonomyCache = { at: Date.now(), value };
  return value;
}

/**
 * The board is two ~250 ms queries over a table that only changes when Brandon runs the tagger,
 * so a view, a bucket chip and a "back" all read the same answer for ten minutes.
 */
const BOARD_TTL_MS = 10 * 60 * 1000;
const boardCache = new Map<string, { at: number; value: AngleBoard }>();

/** Test seam, and what the tagger would call if it ever wrote from the app. */
export function clearAngleCaches(): void {
  boardCache.clear();
  taxonomyCache = null;
}

function toExample(r: any): AngleExample {
  return {
    id: r.id,
    title: r.title,
    channel_id: r.channel_id,
    channel_name: r.channel_name,
    bucket: r.bucket,
    score: r.score != null ? Number(r.score) : null,
    thumbnail_url: r.thumbnail_url,
    variation: r.variation,
    published_at: new Date(r.published_at).toISOString(),
    view_count: Number(r.view_count ?? 0),
  };
}
