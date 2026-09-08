// The old path and the new path, asked the same questions, and diffed.
//
// scripts/{benchmark-scores,backtest-baseline-trend,check-band-calibration}.ts now take
// `--source parquet` and read DuckDB over the R2 archive instead of production Postgres
// (lib/readings/harness-source.ts). The scoring math above that seam is untouched and
// deterministic, so the only thing that can make a run disagree is the data layer — which is
// exactly what this measures: the harnesses' OWN query texts, run through both engines over the
// same scoped corpus, compared row for row and value for value.
//
// Scope it to a channel whose corpus has been exported (scripts/export-tables.ts --channel), so
// the parquet side is a COMPLETE world rather than a partial one — a diff against a truncated
// export would report differences that are about coverage, not correctness.
//
// Usage:
//   npx tsx scripts/export-tables.ts --channel UC...            # build the scoped corpus
//   npx tsx scripts/verify-parquet-harness.ts --channel UC... \
//     --export-day 2026-09-08-channel-UC...
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import { openParquetSource } from '../lib/readings/parquet-source';
import { OBSERVATION_RECORDS_SQL } from '../lib/scoring/observations';
import { HARNESS_QUERIES } from '../lib/scoring/harness-sql';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const channel = arg('--channel');
const exportDay = arg('--export-day');
const LIMIT = Number(arg('--videos') ?? 0) || 300;
/**
 * Only compare videos published inside the window the raw-readings archive covers.
 *
 * The archive began on 2026-09-01. For an older video Postgres holds readings that were never
 * archived, so a raw diff would report a COVERAGE gap as a correctness one. Restricting the
 * scope to videos whose whole life is inside the archived window makes the two sides answerable
 * for the same rows — which is the only way the comparison means anything.
 */
const since = arg('--published-since');
/**
 * The days the raw-readings archive actually holds, as `YYYY-MM-DD..YYYY-MM-DD`.
 *
 * The archive is by construction behind live Postgres — scripts/archive-readings.ts only writes a
 * day once it is older than the dense window — so a raw diff of a readings query always shows the
 * last few days as "only in postgres". That is a COVERAGE fact, not a correctness one. Given a
 * window, rows on both sides are restricted to it before comparison, so what is compared is what
 * both stores are answerable for. Rows carrying no timestamp are always compared.
 */
const window = arg('--window');
const [winFrom, winTo] = window
  ? [Date.parse(`${window.split('..')[0]}T00:00:00Z`), Date.parse(`${window.split('..')[1]}T23:59:59.999Z`)]
  : [-Infinity, Infinity];
const TIME_KEYS = ['at', 'at_ms', 'sampled_at', 'scored_at'];
function inWindow(r: any): boolean {
  for (const k of TIME_KEYS) {
    if (r[k] === undefined || r[k] === null) continue;
    const t = typeof r[k] === 'number' ? (k === 'at_ms' ? r[k] : r[k] > 1e12 ? r[k] : r[k] * 1000) : Date.parse(String(r[k]));
    if (Number.isFinite(t)) return t >= winFrom && t <= winTo;
  }
  return true;
}
if (!channel) { console.error('--channel <id> is required'); process.exit(1); }

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 1, timeoutMs: 120_000 });
const pg = async (sql: string, params: any[] = []) => (await pool.query(sql, params)).rows as any[];
const src = await openParquetSource({ exportDay, verbose: true });

/** Numbers from two engines are equal when they round to the same double, not when they are the
 *  same object: pg returns numerics as strings, DuckDB as doubles. */
function canon(v: any): any {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number(v.toPrecision(12));
  const n = Number(v);
  if (typeof v === 'string' && v !== '' && Number.isFinite(n)) return Number(n.toPrecision(12));
  if (typeof v === 'string') { const t = Date.parse(v); if (!Number.isNaN(t) && /\d{4}-\d{2}-\d{2}/.test(v)) return t; }
  return v;
}
const canonRow = (r: any) => Object.fromEntries(Object.keys(r).sort().map((k) => [k, canon(r[k])]));
const key = (r: any) => JSON.stringify(canonRow(r));

const ids = (await pg(
  `select id from videos where channel_id = $1
     ${since ? 'and published_at >= $3::timestamptz' : ''}
    order by published_at desc limit $2`,
  since ? [channel, LIMIT, since] : [channel, LIMIT]
)).map((r) => r.id);
console.log(`scope: ${ids.length} videos on ${channel}`);

let failures = 0;
async function diff(name: string, sql: string, params: any[]) {
  const t0 = Date.now();
  const a = (await pg(sql, params)).map(canonRow).filter(inWindow);
  const tPg = Date.now() - t0;
  const t1 = Date.now();
  const b = (await src.q(sql, params)).map(canonRow).filter(inWindow);
  const tPq = Date.now() - t1;

  // Order is not part of the answer for a set comparison — every consumer of these queries
  // groups by video_id and sorts itself — so rows are matched as a multiset.
  const bag = new Map<string, number>();
  for (const r of a) bag.set(key(r), (bag.get(key(r)) ?? 0) + 1);
  let onlyPg = 0, onlyPq = 0;
  for (const r of b) {
    const k = key(r), n = bag.get(k) ?? 0;
    if (n > 0) bag.set(k, n - 1); else onlyPq++;
  }
  for (const n of bag.values()) onlyPg += n;
  const ok = a.length === b.length && onlyPg === 0 && onlyPq === 0;
  if (!ok) failures++;
  console.log(
    `${ok ? 'MATCH  ' : 'DIFFER '} ${name.padEnd(26)} pg ${String(a.length).padStart(7)} rows ${String(tPg).padStart(6)} ms` +
    ` | parquet ${String(b.length).padStart(7)} rows ${String(tPq).padStart(6)} ms` +
    (ok ? '' : `  | only-pg ${onlyPg} only-parquet ${onlyPq}`)
  );
  if (!ok) {
    const sample = [...bag.entries()].filter(([, n]) => n > 0).slice(0, 2).map(([k]) => k);
    for (const s of sample) console.log(`    only in postgres: ${s.slice(0, 300)}`);
  }
}

// The canonical readings seam (lib/scoring/prior-load.ts loadRecords), and the three harnesses'
// own query texts, lifted verbatim into lib/scoring/harness-sql.ts so this file cannot drift
// from what the harnesses actually run.
await diff('observation_records', OBSERVATION_RECORDS_SQL, [ids]);
await diff('benchmark.records', HARNESS_QUERIES.benchmarkRecords, [ids]);
await diff('benchmark.day30', HARNESS_QUERIES.benchmarkDay30, [ids]);
await diff('benchmark.population', HARNESS_QUERIES.benchmarkPopulation, [24]);
await diff('backtest.snapsFor', HARNESS_QUERIES.backtestSnapshots, [ids]);
await diff('calibration.records', HARNESS_QUERIES.calibrationRecords, [ids]);
await diff('calibration.day30', HARNESS_QUERIES.calibrationDay30, [ids]);
await diff('calibration.meta', HARNESS_QUERIES.calibrationMeta, [ids]);

console.log(failures ? `\n${failures} quer(y|ies) DIFFER` : '\nall queries identical');
await src.close();
await pool.end();
process.exit(failures ? 1 : 0);
