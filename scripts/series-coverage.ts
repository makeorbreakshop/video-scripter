// Is the corpus covered well enough to turn SERIES_READ=1 on?
//
// The flag is worth flipping only when a read finds a file. A miss is not free — it is an R2
// round trip (121 ms measured) ON TOP OF the Postgres reads it was meant to replace — so at low
// coverage turning it on makes every video page slower and buys nothing.
//
// Two numbers, and neither is guessed:
//   coverage      what share of a RANDOM SAMPLE of the videos the page can actually be opened
//                 for (those with readings) has a series file on R2. Sampled, not enumerated:
//                 listing the bucket is a per-object round trip and proves nothing extra.
//   queue depth   how many videos are sitting in series_dirty, and whether that number is going
//                 up. A file that exists but is stale is still a wrong chart, and the drain is
//                 what keeps it honest — coverage with a growing queue is not readiness.
//
// It also reports video_obs_cache coverage over the same sample, since that cache is invalidated
// by the same queue.
//
// Read-only. Two small Postgres reads and `--sample` HEAD requests to R2.
//
// Usage:
//   npx tsx scripts/series-coverage.ts
//   npx tsx scripts/series-coverage.ts --sample 500 --json
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import { readSeriesFile, SERIES_DIRTY_COUNT_SQL, SERIES_DIRTY_DDL } from '../lib/readings/series-store';
import { r2Config, MISSING_CREDENTIALS } from '../lib/readings/archive';
import { PRIOR_WINDOW } from '../lib/scoring/core';

const args = process.argv.slice(2);
const arg = (f: string, d?: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const SAMPLE = Number(arg('--sample', '200'));
const JSON_OUT = args.includes('--json');
/** A file built before its video's newest reading is stale even though it exists. */
const STALE_HOURS = Number(arg('--stale-hours', '24'));

const cfg = r2Config();
if (!cfg) { console.error(MISSING_CREDENTIALS); process.exit(1); }

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: 60_000 });
const q = async <T = any>(sql: string, params: any[] = []): Promise<T[]> => (await pool.query(sql, params)).rows as T[];

await pool.query(SERIES_DIRTY_DDL);
const queue = Number((await q<{ n: string }>(SERIES_DIRTY_COUNT_SQL))[0]?.n ?? 0);

// The population that matters is "videos with readings", which is what view_tracking_priority is
// — two orders of magnitude smaller than `videos` and index-backed, so this is never a corpus
// scan. tablesample gives a uniform sample without an ORDER BY random() over the whole thing.
const universe = Number((await q<{ n: string }>(`select count(*)::text as n from view_tracking_priority`))[0]?.n ?? 0);
const ids = (await q<{ video_id: string }>(
  `select video_id from view_tracking_priority order by random() limit $1`, [SAMPLE])).map((r) => r.video_id);

const cached = new Set((await q<{ video_id: string }>(
  `select video_id from video_obs_cache where video_id = any($1::text[])`, [ids]).catch(() => []))
  .map((r) => r.video_id));
const dirty = new Set((await q<{ video_id: string }>(
  `select video_id from series_dirty where video_id = any($1::text[])`, [ids])).map((r) => r.video_id));

let present = 0, stale = 0;
const cutoff = Date.now() - STALE_HOURS * 3600_000;
// Eight at a time: enough to not take a minute, few enough to be polite to the bucket.
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(8, ids.length) }, async () => {
  for (;;) {
    const id = ids[cursor++];
    if (id === undefined) return;
    const file = await readSeriesFile(id, cfg).catch(() => null);
    if (!file) continue;
    present++;
    if (Date.parse(file.built_at) < cutoff) stale++;
  }
}));

// video_obs_cache does not target the same population: it only ever needs the PRIORS — the recent
// long-form videos of tracked channels — so its coverage against "every video with readings"
// would always read as ~0 and mean nothing. Report it against its own target instead.
const obsRows = Number((await q<{ n: string }>(`select count(*)::text as n from video_obs_cache`).catch(() => [{ n: '0' }]))[0]?.n ?? 0);
const obsTarget = Number((await q<{ n: string }>(
  `select (count(distinct channel_id) * $1)::text as n from channel_tracking`, [PRIOR_WINDOW * 2]))[0]?.n ?? 0);

const pct = (n: number) => `${((100 * n) / (ids.length || 1)).toFixed(1)}%`;
const report = {
  at: new Date().toISOString(),
  universe, sample: ids.length,
  seriesPresent: present, seriesPresentPct: (100 * present) / (ids.length || 1),
  seriesStale: stale, seriesStalePct: (100 * stale) / (ids.length || 1),
  /** What SERIES_READ=1 would actually cost today: every miss is an extra R2 round trip. */
  expectedFallbackPct: (100 * (ids.length - present)) / (ids.length || 1),
  obsCachePresent: cached.size, obsCachePresentPct: (100 * cached.size) / (ids.length || 1),
  dirtyInSample: dirty.size,
  queueDepth: queue,
  obsCacheRows: obsRows, obsCacheTarget: obsTarget,
  obsCacheCoveragePct: obsTarget ? (100 * obsRows) / obsTarget : 0,
  ready: present / (ids.length || 1) >= 0.95 && queue < universe * 0.05,
};

if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`series coverage — ${ids.length} of ${universe} videos with readings, sampled at random`);
  console.log(`  series file present   ${present} (${pct(present)})`);
  console.log(`  ...built over ${STALE_HOURS}h ago  ${stale} (${pct(stale)})`);
  console.log(`  SERIES_READ=1 would fall back on ${pct(ids.length - present)} of reads today`);
  console.log(`  video_obs_cache row   ${cached.size} (${pct(cached.size)})`);
  console.log(`  in series_dirty       ${dirty.size} (${pct(dirty.size)}) — queue depth ${queue}`);
  console.log(`  video_obs_cache       ${obsRows} of ~${obsTarget} priors (${obsTarget ? ((100 * obsRows) / obsTarget).toFixed(1) : '0.0'}%)`);
  console.log(report.ready
    ? '  READY: coverage is high and the queue is small relative to the corpus.'
    : '  NOT READY: leave SERIES_READ off. Coverage under 95%, or the dirty queue is not draining.');
}
await pool.end();
