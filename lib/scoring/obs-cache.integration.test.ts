// The proof that scoring off the cached observation record changed no number.
//
// For a sample of real, scored videos this builds both arms from the same priors: the CONTROL
// arm loads every prior's record from the raw union (OBS_CACHE=0, the code path as it was), and
// the TEST arm loads them from video_obs_cache — refreshing the rows first, from the same query,
// so the comparison is of the storage and not of a stale queue. Then it compares the two things
// a reader can see: the score, and the channel's typical curve over the chart's grid.
//
// Deviation must be 0. Not close — the cache is meant to be the same bytes.
//
// This refreshes derived cache rows. It therefore requires an explicit production-integration
// opt-in even when the suite is targeted and database credentials happen to be present.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { makeTimedPool } from '../admin/db';
import { curvePriorsFrom, loadMeta, loadPriorRefs, loadRecords } from './prior-load';
import { channelCurve } from './curve';
import { observationRecords, OBSERVATION_RECORDS_SQL } from './observations';
import { OBS_CACHE_DDL, OBS_CACHE_UPSERT_SQL, encodeObservations, decodeObservations, obsCacheStats } from './obs-cache';
import type { GlobalParams } from './core';
import { scoreParamsQuery } from '../app/score-version';

const d = process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1' && process.env.DATABASE_URL
  ? describe
  : describe.skip;
jest.setTimeout(300_000);

/** Small on purpose: every read below is index-backed, but the union arm is the expensive one. */
const SAMPLE = Number(process.env.OBS_CACHE_SAMPLE ?? 12);
/** The ages the video page draws the dashed line at, near enough. */
const GRID = [0.5, 1, 2, 3, 7, 14, 30, 60, 90, 180, 365];

describe('the cache round-trips a record exactly', () => {
  it('encode/decode is the identity', () => {
    const points = observationRecords([
      { video_id: 'v', published_at: '2026-01-01T00:00:00Z', at: '2026-01-02T00:00:00Z', views: 10, source: 'sample' },
      { video_id: 'v', published_at: '2026-01-01T00:00:00Z', at: '2026-01-03T00:00:00Z', views: 25, source: 'rss', received_at: '2026-01-03T00:05:00Z' },
    ]).get('v')!;
    expect(decodeObservations(encodeObservations(points))).toEqual(points);
  });
});

d('scoring off video_obs_cache equals scoring off the raw union', () => {
  const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: 60_000 });
  const q = async (sql: string, params: any[] = []) => (await pool.query(sql, params)).rows;
  afterAll(async () => { await pool.end(); });

  it(`agrees exactly on ${SAMPLE} videos' priors and typical curves`, async () => {
    await pool.query(OBS_CACHE_DDL);
    const params = (await q(...scoreParamsQuery('params')))[0]?.params as GlobalParams | undefined;
    const ids = (await q(
      `select v.id from videos v join video_scores s on s.video_id = v.id
        where v.published_at > now() - interval '120 days'
        order by v.published_at desc limit $1`, [SAMPLE])).map((r: any) => r.id as string);
    expect(ids.length).toBeGreaterThan(0);

    // The priors, and their lifetime fallback, are loaded ONCE and shared by both arms. They
    // are not what changed, and loadMeta reads `now()` — two calls seconds apart legitimately
    // disagree on a prior's age, which would be noise in a test about storage.
    const refsOf = await loadPriorRefs(q, ids);
    const priorIds = [...new Set([...refsOf.values()].flat().map((p) => p.id))];
    const metas = await loadMeta(q, priorIds);

    // Control: the raw union, exactly as loadRecords ran before the cache existed.
    process.env.OBS_CACHE = '0';
    const controlRecords = await loadRecords(q, priorIds);

    // Populate the cache for every prior in play, from the same canonical query.
    for (let i = 0; i < priorIds.length; i += 100) {
      const part = priorIds.slice(i, i + 100);
      const byVideo = observationRecords(await q(OBSERVATION_RECORDS_SQL, [part]));
      await pool.query(OBS_CACHE_UPSERT_SQL, [
        part, part.map((id) => (byVideo.get(id) ?? []).length),
        part.map((id) => encodeObservations(byVideo.get(id) ?? [])),
      ]);
    }
    delete process.env.OBS_CACHE;
    const before = obsCacheStats.hits;
    const testRecords = await loadRecords(q, priorIds);
    const served = obsCacheStats.hits - before;

    // A prior sitting in series_dirty is deliberately a miss and takes the union in both arms,
    // so it proves nothing; require that most of the sample actually came out of the cache.
    expect(testRecords.size).toBe(controlRecords.size);
    // Without this a cache that answers nothing would pass by falling back to the control path.
    // It is not all of them: a prior that is sitting in series_dirty is deliberately a miss, and
    // on recent videos a good fraction of the channel's history is always queued.
    expect(served).toBeGreaterThan(0);

    // So that the miss path does not hide anything, compare the STORED bytes against the raw
    // record for every prior, dirty ones included.
    const stored = new Map<string, any>((await q(
      `select video_id, obs from video_obs_cache where video_id = any($1::text[])`, [priorIds]))
      .map((r: any) => [r.video_id as string, decodeObservations(r.obs)]));
    expect(stored.size).toBe(priorIds.length);
    for (const id of priorIds) expect(stored.get(id)).toEqual(controlRecords.get(id) ?? []);

    for (const id of ids) {
      const refs = refsOf.get(id) ?? [];
      const a = curvePriorsFrom(refs, controlRecords, metas);
      const b = curvePriorsFrom(refs, testRecords, metas);
      expect(b).toEqual(a);
      if (params && a.length) {
        for (const day of GRID) {
          expect(channelCurve(b, day, params)).toEqual(channelCurve(a, day, params));
        }
      }
    }
  });
});
