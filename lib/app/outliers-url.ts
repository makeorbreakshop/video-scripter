// The pure half of /app/outliers: what a URL means, and which channel ids a bucket reads.
//
// Its own module because the client filter row (app/app/_components/outlier-controls.tsx) needs
// the URL builder, and lib/app/outliers.ts reaches Postgres — importing that from a client
// component would drag `pg` into the browser bundle. Only types and pure functions cross here.
import type { ChannelRelations } from '../semantic/channel-relations';

export const OUTLIER_PAGE = 60;
export const OUTLIER_MAX_ROWS = 240;

export type Bucket = 'near' | 'adjacent' | 'far';
export type OutlierSort = 'score' | 'views' | 'published';
export type OutlierRange = '7d' | '30d' | '90d';

export const RANGE_DAYS: Record<OutlierRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** The quality guards a viewer can move. Everything here reaches SQL as a bound parameter. */
export type Confidence = 'confirmed' | 'likely' | 'early';

/** How many times the channel's own baseline a video has to beat. */
export const MIN_MULTIPLES = [2, 3, 5, 10] as const;
export type MinMultiple = (typeof MIN_MULTIPLES)[number];
export const DEFAULT_MIN: MinMultiple = 2;

/** Ordered as the menu reads: strongest evidence first. */
export const CONFIDENCES: Confidence[] = ['confirmed', 'likely', 'early'];
export const DEFAULT_CONF: Confidence[] = ['confirmed', 'likely'];

/**
 * Baseline floor, in views. 0 means "any".
 *
 * The embedding pool uses 5,000, which is right for a pool meant to be representative of
 * YouTube at large and wrong for reading one small niche: of 85 otherwise-qualifying laser
 * uploads in Brandon's Near bucket over 30 days, 5,000 leaves 9. 500 is the noise floor —
 * below it a "10x" is ten people — so that is the default here.
 */
export const FLOORS = [0, 500, 1_000, 5_000, 25_000] as const;
export type Floor = (typeof FLOORS)[number];
export const DEFAULT_FLOOR: Floor = 500;

export const floorLabel = (f: Floor): string =>
  f === 0 ? 'Any' : f >= 1_000 ? `${f / 1_000}K` : String(f);

const first = (value: string | string[] | null | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value) ?? undefined;

export function parseBucket(value: string | string[] | null | undefined): Bucket {
  const v = first(value);
  return v === 'adjacent' || v === 'far' ? v : 'near';
}

/** `score` is the default and the fallback; `views` and `published` are the two other rankings. */
export function parseOutlierSort(value: string | string[] | null | undefined): OutlierSort {
  const v = first(value);
  return v === 'published' || v === 'views' ? v : 'score';
}

export function parseOutlierRange(value: string | string[] | null | undefined): OutlierRange {
  const v = first(value);
  return v === '7d' || v === '90d' ? v : '30d';
}

export function parseMin(value: string | string[] | null | undefined): MinMultiple {
  const n = Number(first(value));
  return (MIN_MULTIPLES as readonly number[]).includes(n) ? (n as MinMultiple) : DEFAULT_MIN;
}

/**
 * A comma list of confidence names, whitelisted against CONFIDENCES and returned in that order.
 * An empty or entirely unknown list falls back to the default rather than to "no rows".
 */
export function parseConfidence(value: string | string[] | null | undefined): Confidence[] {
  const raw = first(value);
  if (raw === undefined) return DEFAULT_CONF;
  const asked = new Set(raw.split(',').map((s) => s.trim().toLowerCase()));
  const picked = CONFIDENCES.filter((c) => asked.has(c));
  return picked.length ? picked : DEFAULT_CONF;
}

export function parseFloor(value: string | string[] | null | undefined): Floor {
  const raw = (first(value) ?? '').trim().toLowerCase();
  if (raw === '') return DEFAULT_FLOOR; // an empty value is not the number zero
  if (raw === 'any') return 0;
  const n = Number(raw);
  return (FLOORS as readonly number[]).includes(n) ? (n as Floor) : DEFAULT_FLOOR;
}

const sameConf = (a: Confidence[], b: Confidence[]) =>
  a.length === b.length && a.every((c, i) => c === b[i]);

/** A YouTube channel id, and only that — this value reaches a query parameter. */
export function parseAnchor(value: string | string[] | null | undefined): string | null {
  const v = (first(value) ?? '').trim();
  return /^UC[A-Za-z0-9_-]{22}$/.test(v) ? v : null;
}

/** The page's URL, with only the parameters that differ from the defaults. */
export function outliersHref(params: {
  bucket: Bucket; sort: OutlierSort; range: OutlierRange; anchor: string | null; n?: number;
  min?: MinMultiple; conf?: Confidence[]; floor?: Floor;
}): string {
  const p = new URLSearchParams();
  if (params.bucket !== 'near') p.set('bucket', params.bucket);
  if (params.sort !== 'score') p.set('sort', params.sort);
  if (params.range !== '30d') p.set('range', params.range);
  if (params.min !== undefined && params.min !== DEFAULT_MIN) p.set('min', String(params.min));
  if (params.conf && !sameConf(params.conf, DEFAULT_CONF)) p.set('conf', params.conf.join(','));
  if (params.floor !== undefined && params.floor !== DEFAULT_FLOOR) {
    p.set('floor', params.floor === 0 ? 'any' : String(params.floor));
  }
  if (params.anchor) p.set('anchor', params.anchor);
  if (params.n) p.set('n', String(params.n));
  const s = p.toString();
  return `/app/outliers${s ? `?${s}` : ''}`;
}

export function parseRows(value: string | string[] | null | undefined): number {
  const n = parseInt(first(value) ?? '', 10);
  if (!Number.isFinite(n)) return OUTLIER_PAGE;
  return Math.min(Math.max(n, OUTLIER_PAGE), OUTLIER_MAX_ROWS);
}

/**
 * Which channel ids a bucket reads, and on which side of the comparison.
 *
 * `near` and `adjacent` are the buckets' own lists. `far` is everything else, so it carries the
 * union of the two as an EXCLUSION — that also admits channels the identity collection has never
 * seen, which is the point: "far" means "not in my neighbourhood", not "ranked far".
 */
export function bucketIds(
  relations: Pick<ChannelRelations, 'near' | 'adjacent'>,
  bucket: Bucket
): { ids: string[]; mode: 'include' | 'exclude' } {
  const near = relations.near.map((c) => c.channel_id);
  const adjacent = relations.adjacent.map((c) => c.channel_id);
  if (bucket === 'near') return { ids: near, mode: 'include' };
  if (bucket === 'adjacent') return { ids: adjacent, mode: 'include' };
  return { ids: [...near, ...adjacent], mode: 'exclude' };
}

