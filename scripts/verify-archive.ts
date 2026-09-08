// The harness. Run it any time to ask whether the archive is trustworthy and whether thinning
// has cost anything: `npm run verify:archive`.
//
// Five checks, each a pass/fail line:
//   a  the last archived day: Postgres rows vs R2 rows vs checksum
//   b  a random video past the dense window: raw points in R2 ⊇ thinned points in Postgres
//   c  the drawn chart line for three named videos, before vs after thinning (≤ 1 % deviation)
//   d  score equality: the growth exponent every score is built on, from full vs thinned input
//   e  database and per-table sizes, the day-over-day delta, and days of disk left
//
// Checks a and b need R2 credentials; without them they report
// "archive not verified: no credentials" rather than passing quietly. c, d and e are pure
// Postgres and always run — c and d simulate the thinning in memory, so they are meaningful
// before a single row has been deleted.
//
// Direct Postgres only (2026-08-31 org-wide egress rule).
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import {
  READING_RETENTION, survivingReadings, checksum, ms, utcDay,
  type Reading, type ArchivedDay, type ReadingSource,
} from '../lib/readings/retention';
import {
  selectDaySql, countDaySql, ARCHIVE_LEDGER_DDL, LEDGER_SELECT_SQL,
} from '../lib/readings/sql';
import { r2Config, MISSING_CREDENTIALS, readReadingsDay, rawReadings } from '../lib/readings/archive';
import { videoPage as adminVideoPage } from '../lib/admin/queries';
import { mergeObservations } from '../lib/scoring/observations';
import { buildSeries } from '../lib/app/chart-series';
import { horizonFor } from '../lib/app/chart-horizon';
import { growthExponent, qResidual, bucketFor, fittedBuckets, MODEL_VERSION, type GlobalParams } from '../lib/scoring/core';

const args = process.argv.slice(2);
const arg = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const SAMPLE_N = Number(arg('--videos') ?? 200);
/**
 * Checks c and d decide what to thin at this clock, not at the real one. Today nothing in these
 * tables is even 7 days old, so at the real clock "before" and "after" are the same rows and the
 * checks would pass without testing anything. Shifting the decision clock forward puts every
 * reading in the daily tier and asks the real question: if we thinned all of this tomorrow,
 * would the line move and would any score change? Nothing is written or deleted either way.
 */
const AGE_SHIFT_DAYS = Number(arg('--age-shift-days') ?? 40);
const CHART_IDS = (arg('--chart-ids') ?? '4_ZZnmQr7sI,KFVqHUvp-0w').split(',').filter(Boolean);

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: 600_000 });
const q = async <T = any>(sql: string, params?: any[]): Promise<T[]> =>
  (await pool.query(sql, params)).rows as T[];

const cfg = r2Config();
const now = Date.now();

type Row = { check: string; subject: string; result: string; detail: string };
const rows: Row[] = [];
let failures = 0;
const pass = (check: string, subject: string, detail: string) =>
  rows.push({ check, subject, result: 'PASS', detail });
const fail = (check: string, subject: string, detail: string) => {
  failures++; rows.push({ check, subject, result: 'FAIL', detail });
};
const skip = (check: string, subject: string, detail: string) =>
  rows.push({ check, subject, result: 'SKIP', detail });

// ---- a: the last archived day round-trips ------------------------------------------------

await pool.query(ARCHIVE_LEDGER_DDL);
const ledger = await q<ArchivedDay>(LEDGER_SELECT_SQL);

if (!cfg) {
  skip('a archive round-trip', '—', MISSING_CREDENTIALS);
} else if (!ledger.length) {
  skip('a archive round-trip', '—', 'nothing archived yet (run scripts/archive-readings.ts)');
} else {
  const last = [...ledger].filter((d) => d.source !== 'history').sort((a, b) => (a.day < b.day ? 1 : -1))[0];
  if (!last) {
    skip('a archive round-trip', '—', 'no reading days in the ledger');
  } else {
    const source = last.source as ReadingSource;
    const pgRows = await q<Reading>(selectDaySql(source), [last.day]);
    const r2Rows = await readReadingsDay(cfg, source, last.day);
    const pgSum = checksum(pgRows);
    const r2Sum = r2Rows ? checksum(r2Rows) : '';
    const detail = `pg=${pgRows.length} r2=${r2Rows?.length ?? 0} ledger=${last.rows} ` +
      `pgsum=${pgSum.slice(0, 12)} r2sum=${r2Sum.slice(0, 12)} ledgersum=${String(last.checksum).slice(0, 12)}`;
    // After thinning, Postgres legitimately holds fewer rows than R2; the ledger is the record
    // of what was archived, so that is what the R2 file must still match.
    if (r2Rows && r2Rows.length === Number(last.rows) && r2Sum === last.checksum) {
      pass('a archive round-trip', `${source} ${last.day}`, detail);
    } else {
      fail('a archive round-trip', `${source} ${last.day}`, detail);
    }
  }
}

// ---- b: a video past the dense window is a superset in R2 --------------------------------

const cutoff = new Date(now - READING_RETENTION.denseWindowDays * 86_400_000).toISOString();
const [oldVideo] = await q<{ video_id: string }>(
  `select video_id from rss_samples where at < $1::timestamptz
    order by random() limit 1`, [cutoff]);

if (!cfg) {
  skip('b raw ⊇ thinned', oldVideo?.video_id ?? '—', MISSING_CREDENTIALS);
} else if (!oldVideo) {
  skip('b raw ⊇ thinned', '—', `no rss_samples older than ${READING_RETENTION.denseWindowDays} days yet`);
} else {
  const pgRows = await q<Reading>(
    `select video_id, at, views from rss_samples where video_id = $1 and at < $2::timestamptz order by at`,
    [oldVideo.video_id, cutoff]);
  const raw = await rawReadings(oldVideo.video_id, pgRows[0]?.at ?? cutoff, cutoff, ['rss'], cfg);
  const rawKeys = new Set(raw.map((r) => ms(r.at)));
  const missing = pgRows.filter((r) => !rawKeys.has(ms(r.at)));
  const detail = `pg=${pgRows.length} r2=${raw.length} missing-from-r2=${missing.length}`;
  if (raw.length >= pgRows.length && missing.length === 0) pass('b raw ⊇ thinned', oldVideo.video_id, detail);
  else fail('b raw ⊇ thinned', oldVideo.video_id, detail);
}

// ---- c: the drawn line does not move -----------------------------------------------------
// Thinning is simulated in memory: the same series is built from the full readings and from
// exactly the rows survivingReadings() would leave behind, and compared hour by hour.

/**
 * The rows thinning would leave. The policy reads `at` and `video_id`; every other field on the
 * chart's point objects — views, timeBasis, receivedAt — must survive untouched, or the "after"
 * series is testing the wrong thing.
 */
function thin<T extends { at: string | Date; views?: unknown }>(
  points: T[], id = 'x', publishedAt: string | Date | null = null
): T[] {
  const tagged = points.map((p) => ({ ...p, video_id: id, published_at: publishedAt }));
  const kept = new Set(survivingReadings(tagged as never, thinClock) as unknown as typeof tagged);
  return points.filter((_, i) => kept.has(tagged[i]));
}
const thinClock = now + AGE_SHIFT_DAYS * 86_400_000;

// A third subject: the oldest video that actually has readings, so the daily tier is exercised.
const [oldest] = await q<{ id: string }>(
  `select v.id from videos v
    where v.published_at < now() - interval '30 days'
      and exists (select 1 from rss_samples s where s.video_id = v.id)
    order by v.published_at limit 1`);
const chartIds = [...CHART_IDS, ...(oldest ? [oldest.id] : [])];
rows.push({ check: 'c/d thinning clock', subject: `now +${AGE_SHIFT_DAYS}d`, result: '—',
  detail: 'the policy is applied at a shifted clock so the checks exercise the daily tier; nothing is written' });

for (const id of chartIds) {
  try {
    const { video: v, snapshots, samples, rss, score, mult, longtail, bands } = await adminVideoPage(id);
    if (!v) { skip('c chart line', id, 'no such video'); continue; }
    const build = (samp: any[], rssRows: any[]) => {
      const actuals = mergeObservations(v.published_at, snapshots, samp, rssRows, now);
      const ageDays = (now - new Date(v.published_at).getTime()) / 86_400_000;
      const maxDay = Math.max(horizonFor(ageDays), actuals.length ? actuals[actuals.length - 1].day : 0, ageDays);
      return buildSeries({
        actuals, baseline: score?.baseline ?? null, est30: score?.est30 ?? null,
        mult, longtail, horizonDay: maxDay, ageDays, bands,
        assumeZeroOrigin: v.duration !== 'P0D',
      });
    };
    const before = build(samples, rss ?? []);
    const after = build(thin(samples, id, v.published_at), thin(rss ?? [], id, v.published_at));
    const byDay = new Map(after.map((p) => [p.day, p.views]));
    let worst = 0, worstDay = 0;
    for (const p of before) {
      const b = byDay.get(p.day);
      if (b == null || !Number.isFinite(p.views) || p.views === 0) continue;
      const dev = Math.abs(b - p.views) / Math.abs(p.views);
      if (dev > worst) { worst = dev; worstDay = p.day; }
    }
    const detail = `points ${before.length}→${after.length}, readings ${samples.length + (rss?.length ?? 0)}` +
      `→${thin(samples, id, v.published_at).length + thin(rss ?? [], id, v.published_at).length}, max deviation ${(worst * 100).toFixed(3)}% at day ${worstDay.toFixed(2)}`;
    if (worst <= 0.01) pass('c chart line', id, detail); else fail('c chart line', id, detail);
  } catch (e) {
    fail('c chart line', id, (e as Error).message);
  }
}

// ---- d: score equality -------------------------------------------------------------------
// Every score's only dependence on the shape of a video's readings is growthExponent(), which
// reads the EARLIEST and LATEST reading and nothing between them (lib/scoring/core.ts). The
// retention policy keeps both by construction, so this check is what proves the construction.

const [paramsRow] = await q<{ params: GlobalParams }>(
  `select params from score_params where model_version = $1 order by fitted_at desc limit 1`, [MODEL_VERSION]);

const sample = await q<{ id: string; published_at: string }>(
  `select v.id, v.published_at from videos v
    where exists (select 1 from rss_samples s where s.video_id = v.id)
    order by random() limit $1`, [SAMPLE_N]);

if (!sample.length) {
  skip('d score equality', '—', 'no videos with readings');
} else {
  let checked = 0, qChanged = 0, residChanged = 0, worstQ = 0, worstId = '';
  const ids = sample.map((s) => s.id);
  const all = await q<{ video_id: string; at: string; views: string }>(
    `select video_id, at, views from rss_samples where video_id = any($1) order by video_id, at`, [ids]);
  const byVideo = new Map<string, { at: string; views: number }[]>();
  for (const r of all) {
    if (!byVideo.has(r.video_id)) byVideo.set(r.video_id, []);
    byVideo.get(r.video_id)!.push({ at: r.at, views: Number(r.views) });
  }
  for (const s of sample) {
    const points = byVideo.get(s.id);
    if (!points || points.length < 2) continue;
    const published = new Date(s.published_at).getTime();
    const snapsOf = (ps: { at: string; views: number }[]) =>
      ps.map((p) => ({ day: (ms(p.at) - published) / 86_400_000, views: p.views }));
    const kept = thin(points, s.id, s.published_at);
    const qFull = growthExponent(snapsOf(points));
    const qThin = growthExponent(snapsOf(kept));
    checked++;
    if (qFull !== qThin) {
      qChanged++;
      const d = Math.abs((qThin ?? 0) - (qFull ?? 0));
      if (d > worstQ) { worstQ = d; worstId = s.id; }
      if (paramsRow?.params) {
        const age = (now - published) / 86_400_000;
        const bucket = bucketFor(age, fittedBuckets(paramsRow.params));
        if (qResidual(paramsRow.params, bucket, qFull) !== qResidual(paramsRow.params, bucket, qThin)) residChanged++;
      }
    }
  }
  const detail = `${checked} videos with ≥2 readings (thinned at now+${AGE_SHIFT_DAYS}d); growth exponent changed on ${qChanged}, ` +
    `score-affecting (qResidual bin) changes ${residChanged}` +
    (worstId ? `, worst |Δq| ${worstQ.toExponential(2)} on ${worstId}` : '');
  if (residChanged === 0) pass('d score equality', `${SAMPLE_N} random videos`, detail);
  else fail('d score equality', `${SAMPLE_N} random videos`, detail);
}

// ---- e: sizes and days of disk left -------------------------------------------------------

const PROVISIONED_MB = Number(process.env.SUPABASE_DISK_MB ?? 12288);
const [{ mb: dbMb }] = await q<{ mb: string }>(
  `select round(pg_database_size(current_database()) / 1048576.0, 1)::text as mb`);
const tables = await q<{ relname: string; mb: string }>(
  `select c.relname, round(pg_total_relation_size(c.oid) / 1048576.0, 1)::text as mb
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('rss_samples','view_samples','view_snapshots','video_score_history','videos')
    order by pg_total_relation_size(c.oid) desc`);

// Day-over-day growth, measured against the tables' own clocks rather than a stored history.
const growth = await q<{ what: string; mb: string }>(`
  select 'rss_samples' as what,
         round(count(*) * 160 / 1048576.0, 1)::text as mb
    from rss_samples where at > now() - interval '24 hours'
  union all
  select 'view_samples', round(count(*) * 124 / 1048576.0, 1)::text
    from view_samples where sampled_at > now() - interval '24 hours'
  union all
  select 'video_score_history', round(count(*) * 473 / 1048576.0, 1)::text
    from video_score_history where scored_at > now() - interval '24 hours'`);

const perDay = growth.reduce((a, g) => a + Number(g.mb), 0);
const freeMb = PROVISIONED_MB - Number(dbMb);
const daysLeft = perDay > 0 ? freeMb / perDay : Infinity;

console.log('');
console.log('  check                subject                    result  detail');
console.log('  ' + '-'.repeat(110));
for (const r of rows) {
  console.log(`  ${r.check.padEnd(20)} ${r.subject.padEnd(26)} ${r.result.padEnd(7)} ${r.detail}`);
}
console.log('');
console.log(`  e sizes              database                   —       ${dbMb} MB of ${PROVISIONED_MB} MB (${freeMb.toFixed(0)} MB free)`);
for (const t of tables) console.log(`  ${''.padEnd(20)} ${t.relname.padEnd(26)} —       ${t.mb} MB`);
for (const g of growth) console.log(`  ${''.padEnd(20)} ${(g.what + ' /24h').padEnd(26)} —       +${g.mb} MB/day`);
console.log(`  ${''.padEnd(20)} ${'total growth'.padEnd(26)} ${daysLeft < 7 ? 'FAIL' : 'PASS'}    +${perDay.toFixed(0)} MB/day → ` +
  `${Number.isFinite(daysLeft) ? daysLeft.toFixed(1) : '∞'} days of disk left ` +
  `(full ≈ ${Number.isFinite(daysLeft) ? utcDay(now + daysLeft * 86_400_000) : 'never'})`);
if (daysLeft < 7) failures++;
console.log('');
console.log(`  ${rows.filter((r) => r.result === 'PASS').length} passed, ` +
  `${rows.filter((r) => r.result === 'FAIL').length} failed, ` +
  `${rows.filter((r) => r.result === 'SKIP').length} skipped` +
  (cfg ? '' : `\n  ${MISSING_CREDENTIALS}`));
console.log('');

await pool.end();
process.exit(failures ? 1 : 0);
