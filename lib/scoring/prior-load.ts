// Loading the prior set the score divides by — once, for everybody.
//
// The video page's dashed "typical for this channel" line must be the same function the score
// divides by, which means it must be built from the same priors, censored the same way. That was
// only true by hand-copying before: the prior loading lived inside scripts/score-videos.ts's
// v5Batch, so lib/admin/video-curve.ts drew C(30) x a global growth shape instead — a different
// curve that disagreed with the score by up to 3.6x, and for v5 rows was suppressed entirely.
//
// Everything here takes a `q` rather than importing a pool: the scorer runs on its own pg pool
// and the app runs on lib/admin/db's, and neither should have to know about the other.
import { chunk } from '../nightly/tracking-core';
import { PRIOR_STALE_DAYS, PRIOR_WINDOW, type Snapshot } from './core';
import { longformSql } from './longform';
import { OBSERVATION_RECORDS_SQL, observationRecords } from './observations';
import { OBS_CACHE_READ_SQL, decodeCachedObservations, obsCacheEnabled, obsCacheStats } from './obs-cache';
import {
  decodeObservationState,
  observationsFromState,
  type ObservationState,
} from './observation-state';
import type { CurvePrior } from './curve';

export type QueryFn = (sql: string, params?: any[]) => Promise<any[]>;

/** One of a target's prior videos: its id, publish time (epoch ms) and gap before the target. */
export interface PriorRef { id: string; pub: number; ageDays: number }
/** Lifetime count and the age it was read at — the route a pre-tracking prior contributes by. */
export interface PriorMeta { views: number; age: number }
export interface RecordLoadOptions {
  rawMissBudget?: number;
  requireFormat2?: boolean;
  /** Optional cache-only side channel for callers that need source-specific facts. */
  stateSink?: Map<string, ObservationState>;
  /** Exact day-30 snapshot projection returned by the same compact cache query. */
  day30Sink?: Map<string, number>;
}

export class ObservationCacheMissError extends Error {
  constructor(public readonly missingIds: string[], public readonly rawMissBudget: number) {
    super(`observation cache missed ${missingIds.length} video(s); raw miss budget is ${rawMissBudget}`);
    this.name = 'ObservationCacheMissError';
  }
}

/**
 * Recent prior long-form, public videos of each target's channel, newest first: the v4.0 BASELINE
 * pool. Up to PRIOR_WINDOW of them, minus anything published more than PRIOR_STALE_DAYS before
 * the target. `ageDays` is the target's publish time minus the prior's — what the age kernel
 * weights by, and what lib/scoring/curve reads the channel's cadence off.
 */
export async function loadPriorRefs(q: QueryFn, ids: readonly string[]): Promise<Map<string, PriorRef[]>> {
  const out = new Map<string, PriorRef[]>();
  if (!ids.length) return out;
  const rows: { video_id: string; prior_id: string; gap_days: number; pub: string }[] = await q(
    `/* trace:score.prior-refs */
     select r.id as video_id, p.id as prior_id,
            extract(epoch from (v.published_at - p.published_at))/86400.0 as gap_days,
            p.published_at as pub
       from unnest($1::text[]) as r(id) join videos v on v.id = r.id
       join lateral (select p.id, p.published_at from videos p
                      where p.channel_id = v.channel_id and p.published_at < v.published_at
                        and ${longformSql('p')}
                        and coalesce(p.privacy_status,'public') = 'public' and coalesce(p.view_count,0) > 0
                      order by p.published_at desc nulls last limit ${PRIOR_WINDOW}) p on true
      order by r.id, p.published_at desc`,
    [ids as string[]]
  );
  for (const r of rows) {
    const ageDays = Number(r.gap_days);
    if (ageDays > PRIOR_STALE_DAYS) continue;
    if (!out.has(r.video_id)) out.set(r.video_id, []);
    out.get(r.video_id)!.push({ id: r.prior_id, pub: new Date(r.pub).getTime(), ageDays });
  }
  return out;
}

/**
 * The canonical observation record for a set of videos, at TRUE age: snapshots, high-res samples
 * and RSS merged by lib/scoring/observations. Key arrays are bounded — a very large IN set turns
 * these reads into corpus-wide scans.
 */
export async function loadRecords(
  q: QueryFn,
  ids: readonly string[],
  options: RecordLoadOptions = {},
): Promise<Map<string, Snapshot[]>> {
  const out = new Map<string, Snapshot[]>();
  if (!ids.length) return out;
  const raw: string[] = [];
  const rawMissBudget = options.rawMissBudget ?? 25;
  for (const part of chunk([...ids], 100)) {
    // The cache holds the versioned source state and returns nothing unless its watermark is
    // current. Miss handling is explicit: scheduled scoring passes a zero budget and defers;
    // interactive reads retain a small allowance for availability during rollout.
    let hits = 0;
    if (obsCacheEnabled()) {
      let rows: { video_id: string; obs: Buffer; format?: number }[] = [];
      try {
        rows = await q(OBS_CACHE_READ_SQL, [part]);
      } catch (err) {
        // A missing table on a database that has not run the migration is a miss; the caller's
        // budget still decides whether raw access is allowed.
        if (!warnedObsCache) { warnedObsCache = true; console.warn(`[obs-cache] unavailable: ${(err as Error).message}`); }
      }
      for (const r of rows) {
        const format = Number(r.format ?? 1);
        if (options.requireFormat2 && format !== 2) continue;
        if (format === 2) {
          const state = decodeObservationState(r.obs);
          options.stateSink?.set(r.video_id, state);
          if (r.day30_views !== null && r.day30_views !== undefined) {
            options.day30Sink?.set(r.video_id, Number(r.day30_views));
          }
          out.set(r.video_id, observationsFromState(state));
        } else {
          out.set(r.video_id, decodeCachedObservations(format, r.obs));
        }
        hits++;
      }
    }
    obsCacheStats.hits += hits;
    obsCacheStats.misses += part.length - hits;
    for (const id of part) if (!out.has(id)) raw.push(id);
  }
  if (raw.length > rawMissBudget) throw new ObservationCacheMissError(raw, rawMissBudget);
  for (const part of chunk(raw, 100)) {
    for (const [id, points] of observationRecords(await q(OBSERVATION_RECORDS_SQL, [part]))) out.set(id, points);
  }
  return out;
}

/** One line per process, not one per chunk, when the cache table is not there at all. */
let warnedObsCache = false;

/** Current lifetime count and age in days, for the priors with no usable samples. */
export async function loadMeta(q: QueryFn, ids: readonly string[]): Promise<Map<string, PriorMeta>> {
  if (!ids.length) return new Map();
  const rows = await q(
    `/* trace:score.prior-meta */
     select id, coalesce(view_count,0) as views, extract(epoch from (now() - published_at))/86400.0 as age
       from videos where id = any($1)`,
    [ids as string[]]
  );
  return new Map(rows.map((r: any) => [r.id as string, { views: Number(r.views), age: Number(r.age) }]));
}

/** Assemble the CurvePriors from parts already in hand. Pure — the seam the tests use. */
export function curvePriorsFrom(
  refs: readonly PriorRef[],
  records: Map<string, Snapshot[]>,
  metas: Map<string, PriorMeta>
): CurvePrior[] {
  return refs.map((p) => {
    const m = metas.get(p.id);
    return {
      id: p.id,
      ageDays: p.ageDays,
      samples: records.get(p.id) ?? [],
      lifetime: m && m.views > 0 ? { views: m.views, ageDays: m.age } : null,
    };
  });
}

/**
 * The whole prior set for a batch of targets, ready for channelCurve/scoreV5. Three reads.
 * This is THE definition of "the priors this video is scored against"; anything drawing the
 * channel's typical line must come through here or it is drawing a different curve.
 */
export async function loadCurvePriors(q: QueryFn, ids: readonly string[]): Promise<Map<string, CurvePrior[]>> {
  const refsOf = await loadPriorRefs(q, ids);
  const priorIds = [...new Set([...refsOf.values()].flat().map((p) => p.id))];
  const [records, metas] = await Promise.all([loadRecords(q, priorIds), loadMeta(q, priorIds)]);
  const out = new Map<string, CurvePrior[]>();
  for (const id of ids) out.set(id, curvePriorsFrom(refsOf.get(id) ?? [], records, metas));
  return out;
}
