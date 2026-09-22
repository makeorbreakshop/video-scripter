// The pure half of /app/angles: what a URL means. Its own module because the client filter row
// (app/app/_components/angle-controls.tsx) needs the URL builders, and lib/app/angles.ts reaches
// Postgres — importing that from a client component would drag `pg` into the browser bundle.
//
// Shapes deliberately echo outliers-url.ts: same range chips, same "only non-defaults appear in
// the URL" rule, same single-choice Sort. The one new axis is the angle itself.

export const ANGLE_PAGE = 60;
export const ANGLE_MAX_ROWS = 240;

/** How many examples a board tile shows. Eight fits two rows of four at desktop width. */
export const BOARD_EXAMPLES = 8;

/**
 * Rows fetched per angle before the per-board channel cap is applied. The cap can delete tiles,
 * and an angle that loses three of its eight to a channel already spent elsewhere should still
 * show eight.
 */
export const BOARD_EXAMPLE_HEADROOM = 20;

/**
 * No example tile above this multiple.
 *
 * Scores like 385x (Kim and Garrett) and 509x (xTool) are baseline artifacts, not packaging
 * wins: a brand or collab channel whose recent uploads are all small makes any normal video
 * look like a miracle against its own baseline. They still count in the stats line — the median
 * is robust to them and hiding them there would be a lie — but as the first tile under an angle
 * they teach the wrong lesson and make the page look broken.
 */
export const EXAMPLE_MAX_SCORE = 50;

/**
 * How many tiles one channel may hold: one per angle, three across the whole board.
 *
 * Without the board-wide cap a single prolific neighbour supplies a tile under twelve different
 * angles and the page reads as that channel's back catalogue rather than as a set of framings.
 */
export const EXAMPLES_PER_CHANNEL_PER_ANGLE = 1;
export const EXAMPLES_PER_CHANNEL_PER_BOARD = 3;

/**
 * How far out the "far" band reaches, in channels.
 *
 * Far used to be the complement of near and adjacent — every channel in a 1.1M-video corpus that
 * was not a neighbour — so a random draw from it returned Euro-disco megamixes and NFL recaps.
 * It is now a band: the channels ranked immediately past the adjacent cutoff, closest first.
 * Those are the nearest strangers, which is the only far worth learning from.
 */
export const FAR_BAND_CHANNELS = 600;

/** /app/angles has a fourth bucket the Outliers page does not: "all three at once". */
export type AngleBucket = 'all' | 'near' | 'adjacent' | 'far';
export const ANGLE_BUCKETS: AngleBucket[] = ['all', 'near', 'adjacent', 'far'];

export type AngleRange = '30d' | '90d' | '365d';
export const ANGLE_RANGE_DAYS: Record<AngleRange, number> = { '30d': 30, '90d': 90, '365d': 365 };

/** Median first: the board is a ranking of framings, and a count only says what is common. */
export type AngleSort = 'median' | 'count';
export type DetailSort = 'score' | 'published';

export const DEFAULT_RANGE: AngleRange = '90d';
export const DEFAULT_BUCKET: AngleBucket = 'all';
export const DEFAULT_SORT: AngleSort = 'median';
export const DEFAULT_DETAIL_SORT: DetailSort = 'score';

/** Same guard the Outliers page defaults to, so the two pages count the same videos. */
export const DEFAULT_MIN_MULTIPLE = 2;

const first = (value: string | string[] | null | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value) ?? undefined;

export function parseAngleBucket(value: string | string[] | null | undefined): AngleBucket {
  const v = first(value);
  return v === 'near' || v === 'adjacent' || v === 'far' ? v : 'all';
}

export function parseAngleRange(value: string | string[] | null | undefined): AngleRange {
  const v = first(value);
  return v === '30d' || v === '365d' ? v : '90d';
}

export function parseAngleSort(value: string | string[] | null | undefined): AngleSort {
  return first(value) === 'count' ? 'count' : 'median';
}

export function parseDetailSort(value: string | string[] | null | undefined): DetailSort {
  return first(value) === 'published' ? 'published' : 'score';
}

/**
 * A family id, and only that — this value reaches a query parameter. The taxonomy's own ids are
 * lower-case words and digits joined by underscores; anything else is "no family filter".
 */
export function parseFamily(value: string | string[] | null | undefined): string | null {
  const v = (first(value) ?? '').trim();
  return /^[a-z0-9_]{1,64}$/.test(v) ? v : null;
}

/** Same rule for an angle id, which is the /app/angles/[id] route parameter. */
export const isAngleId = (value: string): boolean => /^[a-z0-9_]{1,64}$/.test(value);

/** A YouTube channel id, and only that. */
export function parseAnchor(value: string | string[] | null | undefined): string | null {
  const v = (first(value) ?? '').trim();
  return /^UC[A-Za-z0-9_-]{22}$/.test(v) ? v : null;
}

export function parseAngleRows(value: string | string[] | null | undefined): number {
  const n = parseInt(first(value) ?? '', 10);
  if (!Number.isFinite(n)) return ANGLE_PAGE;
  return Math.min(Math.max(n, ANGLE_PAGE), ANGLE_MAX_ROWS);
}

export interface BoardParams {
  bucket: AngleBucket;
  range: AngleRange;
  sort: AngleSort;
  family: string | null;
  anchor: string | null;
}

/** The board's URL, carrying only what differs from the defaults. */
export function anglesHref(p: BoardParams): string {
  const s = new URLSearchParams();
  if (p.bucket !== DEFAULT_BUCKET) s.set('bucket', p.bucket);
  if (p.range !== DEFAULT_RANGE) s.set('range', p.range);
  if (p.sort !== DEFAULT_SORT) s.set('sort', p.sort);
  if (p.family) s.set('family', p.family);
  if (p.anchor) s.set('anchor', p.anchor);
  const qs = s.toString();
  return `/app/angles${qs ? `?${qs}` : ''}`;
}

export interface DetailParams {
  bucket: AngleBucket;
  range: AngleRange;
  sort: DetailSort;
  anchor: string | null;
  n?: number;
}

export function angleHref(id: string, p: DetailParams): string {
  const s = new URLSearchParams();
  if (p.bucket !== DEFAULT_BUCKET) s.set('bucket', p.bucket);
  if (p.range !== DEFAULT_RANGE) s.set('range', p.range);
  if (p.sort !== DEFAULT_DETAIL_SORT) s.set('sort', p.sort);
  if (p.anchor) s.set('anchor', p.anchor);
  if (p.n) s.set('n', String(p.n));
  const qs = s.toString();
  return `/app/angles/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`;
}

/** One channel of the pool, with the priority its position in the ranked list gives it. */
export interface BandChannel {
  channel_id: string;
  bucket: Exclude<AngleBucket, 'all'>;
}

interface BandInput {
  near: Array<{ channel_id: string; creator_likeness: number | null }>;
  adjacent: Array<{ channel_id: string; creator_likeness: number | null }>;
  far: Array<{ channel_id: string; creator_likeness: number | null }>;
}

export interface BandOptions {
  /** Below this creator_likeness a channel is dropped entirely. null disables the filter. */
  floor: number | null;
  farLimit?: number;
}

/**
 * The channels the board is allowed to read, in priority order: near, then adjacent, then the
 * far band — each already sorted closest-first by the identity search that produced them.
 *
 * Order is the output, not a detail: the array's position IS the example ranking, so "prefer
 * near, then adjacent, then far, and within far the closest strangers" is expressed once here
 * rather than as an ORDER BY the SQL has to reconstruct.
 *
 * A channel whose creator_likeness is below the floor is dropped from every bucket, including
 * near. A channel with no measurement at all (a point written before the likeness script ran) is
 * kept: an absent number must not silently empty the board.
 */
export function channelBand(relations: BandInput | null, opts: BandOptions): BandChannel[] {
  if (!relations) return [];
  const keep = (c: { creator_likeness: number | null }) =>
    opts.floor == null || c.creator_likeness == null || c.creator_likeness >= opts.floor;
  return [
    ...relations.near.filter(keep).map((c) => ({ channel_id: c.channel_id, bucket: 'near' as const })),
    ...relations.adjacent.filter(keep).map((c) => ({ channel_id: c.channel_id, bucket: 'adjacent' as const })),
    ...relations.far.filter(keep).slice(0, opts.farLimit ?? FAR_BAND_CHANNELS)
      .map((c) => ({ channel_id: c.channel_id, bucket: 'far' as const })),
  ];
}

/**
 * At most `perChannel` tiles for any one channel across the whole board, applied in the order
 * angles are given. Runs after the SQL because the budget is board-wide and the queries are
 * per-angle; the alternative is a window over every example row on the page for a cap that
 * removes a handful of tiles.
 */
export function capChannelsAcrossBoard(
  rows: AngleStat[],
  shown: number,
  perChannel = EXAMPLES_PER_CHANNEL_PER_BOARD,
): AngleStat[] {
  const spent = new Map<string, number>();
  return rows.map((row) => {
    const examples: AngleExample[] = [];
    for (const v of row.examples) {
      if (examples.length >= shown) break;
      const used = spent.get(v.channel_id) ?? 0;
      if (used >= perChannel) continue;
      spent.set(v.channel_id, used + 1);
      examples.push(v);
    }
    return { ...row, examples };
  });
}

// ------------------------------------------------------------------ board shapes

/** One example video on a board tile. The board and the detail page render the same shape. */
export interface AngleExample {
  id: string;
  title: string;
  channel_id: string;
  channel_name: string;
  bucket: Exclude<AngleBucket, 'all'>;
  score: number | null;
  thumbnail_url: string | null;
  variation: string | null;
  published_at: string;
  view_count: number;
}

export interface AngleStat {
  angle_id: string;
  label: string;
  definition: string;
  kind: 'title' | 'thumbnail';
  family_id: string;
  family_label: string;
  family_position: number;
  n: number;
  median: number | null;
  n_near: number;
  n_adjacent: number;
  n_far: number;
  examples: AngleExample[];
}

export interface AngleFamilySection {
  family_id: string;
  family_label: string;
  angles: AngleStat[];
}

/** Sort a family's angles the way the filter bar asks. */
export function sortAngles(angles: AngleStat[], sort: AngleSort): AngleStat[] {
  return [...angles].sort((a, b) =>
    sort === 'count'
      ? b.n - a.n || (b.median ?? 0) - (a.median ?? 0)
      : (b.median ?? 0) - (a.median ?? 0) || b.n - a.n);
}

export function groupByFamily(rows: AngleStat[]): AngleFamilySection[] {
  const map = new Map<string, AngleFamilySection & { position: number }>();
  for (const r of rows) {
    const section = map.get(r.family_id)
      ?? { family_id: r.family_id, family_label: r.family_label, angles: [], position: r.family_position };
    section.angles.push(r);
    map.set(r.family_id, section);
  }
  return [...map.values()].sort((a, b) => a.position - b.position);
}

/**
 * Winning next door, never tried here.
 *
 * n_near = 0 is the whole claim; the floor is what keeps it from being a list of angles nobody
 * anywhere has used more than twice. Ordered by median, because the question is "what is worth
 * trying", not "what is popular".
 *
 * Eight, not five: the pool is now packaged videos from a bounded distance band rather than
 * every guarded outlier in the corpus, so five is a much weaker claim than it used to be.
 */
export const UNUSED_NEAR_FLOOR = 8;

export function unusedNear(rows: AngleStat[]): AngleStat[] {
  return rows
    .filter((r) => r.n_near === 0 && r.n_adjacent + r.n_far >= UNUSED_NEAR_FLOOR)
    .sort((a, b) => (b.median ?? 0) - (a.median ?? 0));
}

