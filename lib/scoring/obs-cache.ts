// The merged observation record, cached: one narrow row per video instead of three range scans.
//
// WHY. lib/scoring/prior-load.ts loadRecords is the single most expensive read in the system.
// Every scored video is divided by ~16 priors, and each prior's observation record was rebuilt
// from scratch — OBSERVATION_RECORDS_SQL unions view_snapshots, view_samples and rss_samples,
// the three biggest tables in the database — on every hourly scoring run AND on every video-page
// render. Measured 2026-09-08: 118M shared blocks read from disk in four days from the scorer
// alone (~900 GB against a 512 MB buffer pool), and 4,450 blocks for one video page.
//
// The output of that work is tiny and changes only when a reading lands. mergeObservations
// collapses a two-year video's thousands of rows into a few hundred points; gzipped that is a
// few hundred bytes. So it is cached: `video_obs_cache` holds the merged record, and a prior
// costs one index probe on a narrow table.
//
// WHY POSTGRES, NOT THE R2 SERIES FILE. Both hold the same readings, and the series file is
// already built by the same drain. But the R2 file is the RAW rows (~50 KB decompressed, the
// scorer's filter not yet applied), and the scorer reads priors in chunks of 100 ids on a pg
// pool it already holds. Postgres serves those 100 ids in ONE round trip of ~100 small rows;
// R2 would be 100 separate GETs, each a network round trip, per chunk — for an hourly job over
// tens of thousands of priors that is the wrong shape entirely, and it would still have to run
// mergeObservations on 5 MB of raw JSON per chunk. The R2 file stays the chart's serving format
// (docs/runbooks/2026-09-08-columnar-readings.md); this is the scorer's.
//
// EXACTNESS. The refresher runs OBSERVATION_RECORDS_SQL itself and stores exactly what
// observationRecords() returned, so a cache hit is equal to the raw union by construction rather
// than by a reimplementation that could drift. Two things could still make a hit differ from a
// fresh read: a reading that landed after the row was built, and mergeObservations' `asOf` clock.
// Both are handled by treating any video sitting in `series_dirty` as a miss — every writer of a
// reading marks the video dirty in the same transaction (lib/readings/series-store.ts) — so a
// video with unincorporated readings falls back to the raw union and is exact.
import { gzipSync, gunzipSync } from 'node:zlib';
import type { Observation } from './observations';
import { decodeObservationState, observationsFromState } from './observation-state';

/** Created by scripts/rebuild-series.ts and by the backfill; the read path never creates it. */
export const OBS_CACHE_DDL = `
  create table if not exists video_obs_cache (
    video_id   text primary key,
    built_at   timestamptz not null default now(),
    n          int not null,
    obs        bytea not null,
    format     smallint not null default 1,
    last_change_id bigint not null default 0
  );
  alter table video_obs_cache add column if not exists format smallint not null default 1;
  alter table video_obs_cache add column if not exists last_change_id bigint not null default 0`;

/**
 * Cache hits for a set of ids. The anti-join against series_dirty is what makes a hit safe: a
 * video whose readings moved since the row was built is queued for rebuild, and until the drain
 * gets to it we do not trust the row.
 */
export const OBS_CACHE_READ_SQL = `
  select c.video_id, c.obs, c.format, c.last_change_id
    from video_obs_cache c
    left join obs_cache_dirty d on d.video_id = c.video_id
   where c.video_id = any($1::text[])
     and (d.video_id is null or c.last_change_id >= d.generation)`;

export const OBS_CACHE_UPSERT_SQL = `
  insert into video_obs_cache (video_id, built_at, n, obs, format, last_change_id)
  select x.video_id, now(), x.n, x.obs, 1, 0
    from unnest($1::text[], $2::int[], $3::bytea[]) as x(video_id, n, obs)
  on conflict (video_id) do update
     set built_at = excluded.built_at, n = excluded.n, obs = excluded.obs,
         format = excluded.format, last_change_id = excluded.last_change_id`;

export const OBS_CACHE_V2_UPSERT_SQL = `
  insert into video_obs_cache (video_id, built_at, n, obs, format, last_change_id)
  select x.video_id, now(), x.n, x.obs, 2, x.last_change_id
    from unnest($1::text[], $2::int[], $3::bytea[], $4::bigint[])
      as x(video_id, n, obs, last_change_id)
  on conflict (video_id) do update
     set built_at = excluded.built_at, n = excluded.n, obs = excluded.obs,
         format = excluded.format, last_change_id = excluded.last_change_id`;

export const OBS_CACHE_COVERAGE_SQL = `select count(*)::bigint as n from video_obs_cache`;

export function encodeObservations(points: readonly Observation[]): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(points), 'utf8'));
}

export function decodeObservations(buf: Buffer | Uint8Array): Observation[] {
  return JSON.parse(gunzipSync(Buffer.from(buf)).toString('utf8')) as Observation[];
}

export function decodeCachedObservations(format: number, buf: Buffer | Uint8Array): Observation[] {
  return format === 2
    ? observationsFromState(decodeObservationState(buf))
    : decodeObservations(buf);
}

/**
 * How often the cache could not answer, since process start. The scorer logs it at the end of a
 * run: a rate that stops falling after the backfill means rows are being invalidated faster than
 * the drain rebuilds them, which is a queue problem, not a cache problem.
 */
export const obsCacheStats = { hits: 0, misses: 0 };

export function obsCacheSummary(): string {
  const { hits, misses } = obsCacheStats;
  const total = hits + misses;
  return total ? `obs cache ${hits}/${total} hits (${((100 * misses) / total).toFixed(1)}% fell back to the raw union)` : 'obs cache unused';
}

/** The kill switch. OBS_CACHE=0 makes every read go to the raw union, as it did before. */
export function obsCacheEnabled(): boolean {
  return process.env.OBS_CACHE !== '0';
}
