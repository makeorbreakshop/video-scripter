// Production scoring benchmark: replay the REAL scorer as-of each age and score its answers.
//
//   npx tsx scripts/benchmark-scores.ts [--months 18] [--time-frac 0.2] [--test-limit 2500]
//                                       [--fit-sample 8000] [--out docs/benchmarks] [--baseline]
//   npx tsx scripts/benchmark-scores.ts --compare docs/benchmarks/<other>.json [--against BASELINE]
//
// What it does, for every test video that has a day-27..33 truth:
//   for t in 0.5 1 2 3 5 7 14 -- find the observation nearest age t, freeze the clock at that
//   observation's timestamp T, hide everything after T (the video's own later readings AND every
//   prior's day-30 that had not happened yet), and call lib/scoring/core.scoreVideo -- the same
//   function scripts/score-videos.ts calls in production. Nothing is reimplemented here.
//
// Two splits:
//   heldout  the deterministic 1/16 of lib/scoring/bands.heldOut -- the SAME split the forecast
//            bands are fitted against, reused so one holdout serves both checks.
//   time     videos published after the fit cut (the last --time-frac of the window by publish
//            date), which the refit below never saw.
// The global multiplier and Q-residual tables are REFIT here from train rows only (core.fitParams,
// the production fitter) so neither split is scored by parameters fitted on itself. The long-tail
// table is carried over from score_params: it is a corpus-wide nuisance table used only to turn a
// prior's lifetime count into a day-30 estimate, and refitting it would need a second full scan.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {
  scoreVideo, fitParams, bucketFor, fittedBuckets, bucketTolerance, growthExponent, median,
  priorV30 as corePriorV30, publishGapDays, priorWindow, PRIOR_WINDOW, PRIOR_STALE_DAYS,
  MODEL_VERSION, DAY_BUCKETS, type GlobalParams, type FitRow, type Snapshot,
} from '../lib/scoring/core';
import { heldOut } from '../lib/scoring/bands';
import { longformSql } from '../lib/scoring/longform';
import {
  buildReport, reportMarkdown, compareMarkdown, compareReports, PACKAGING_COVERAGE_START,
  type BenchRow, type BenchmarkReport, type LiftRow, type PackagingChange,
} from '../lib/scoring/benchmark';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const has = (k: string) => process.argv.includes(k);

const OUT_DIR = arg('--out') ?? 'docs/benchmarks';
const COMPARE = arg('--compare');
const AGAINST = arg('--against');
const MONTHS = Number(arg('--months') ?? 18);
const TIME_FRAC = Number(arg('--time-frac') ?? 0.2);
const TEST_LIMIT = Number(arg('--test-limit') ?? 2500);
const FIT_SAMPLE = Number(arg('--fit-sample') ?? 8000);
const WRITE_BASELINE = has('--baseline');
// Which stored score_params row supplies the two tables this harness cannot refit from train
// rows: the long tail and the sub-day launch ladder. Defaults to this build's MODEL_VERSION.
// Point it at the reference's version to compare a model change against a run made with the
// SAME carried-over tables -- otherwise a MODEL_VERSION bump silently also swaps in a freshly
// fitted launch ladder, and the sub-day cells move for a reason that has nothing to do with
// the change under test.
const PARAMS_VERSION = arg('--params-version') ?? MODEL_VERSION;
const AGES = [0.5, 1, 2, 3, 5, 7, 14];
const SPLITS = ['heldout', 'time'];
const HOLDOUT_SHARE = Number(arg('--holdout') ?? 1 / 16);
const DAY = 86_400_000;

const tolFor = (t: number) => (t < 1 ? t * 0.5 : t <= 3 ? 1 : t <= 7 ? 2 : 3);

// ---------------------------------------------------------------- compare mode
function readReport(p: string): BenchmarkReport {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as BenchmarkReport;
}
if (COMPARE) {
  const refPath = AGAINST ?? (() => {
    const ptr = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'BASELINE.json'), 'utf8'));
    return path.join(OUT_DIR, ptr.run);
  })();
  const cand = readReport(COMPARE);
  const ref = readReport(refPath);
  console.log(compareMarkdown(cand, ref));
  const { verdict } = compareReports(cand, ref);
  console.log(`reference: ${refPath}`);
  process.exit(verdict === 'worse' ? 1 : 0);
}

// ------------------------------------------------------------------- run mode
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 600000').catch(() => {}); });
const q = async (sql: string, params?: any[]): Promise<any[]> => (await pool.query(sql, params)).rows as any[];
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const chunk = <T,>(xs: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < xs.length; i += n) o.push(xs.slice(i, i + n)); return o; };

type Obs = { day: number; views: number; at: number };

/** The video's observation record, exactly as scripts/score-videos.ts builds it (same three
 *  sources, same 12-hour RSS precedence rule), plus the wall-clock time of each reading so the
 *  replay can censor on it. */
async function records(ids: string[]): Promise<Map<string, Obs[]>> {
  const out = new Map<string, Obs[]>();
  for (const group of chunk(ids, 2000)) {
    const rows = await q(
      `with src as (
          select video_id, snapshot_date::timestamptz + interval '12 hours' as at, view_count as views, 2 as rank
            from view_snapshots where video_id = any($1)
          union all
          select video_id, sampled_at, view_count, 1 from view_samples where video_id = any($1)
          union all
          select video_id, at, views, 0 from rss_samples where video_id = any($1) and views is not null
        ), paid as (select video_id, at from src where rank > 0)
        select x.video_id,
               extract(epoch from (x.at - v.published_at))/86400.0 as day,
               x.views, extract(epoch from x.at)*1000 as at_ms
          from src x join videos v on v.id = x.video_id
         where x.views > 0 and x.at >= v.published_at
           and (x.rank > 0 or not exists (
                 select 1 from paid p where p.video_id = x.video_id
                   and abs(extract(epoch from (p.at - x.at))) < 43200))
         order by x.video_id, x.at`,
      [group]
    );
    for (const r of rows) {
      if (!out.has(r.video_id)) out.set(r.video_id, []);
      out.get(r.video_id)!.push({ day: Number(r.day), views: Number(r.views), at: Number(r.at_ms) });
    }
  }
  return out;
}

/** day-27..33 truth, with the reading's own age and timestamp (needed for censoring). */
type Truth = { v30: number; day: number; at: number };
async function day30(ids: string[]): Promise<Map<string, Truth>> {
  const out = new Map<string, Truth>();
  for (const group of chunk(ids, 5000)) {
    const rows = await q(
      `select distinct on (s.video_id) s.video_id, s.view_count, s.days_since_published as day,
              extract(epoch from (s.snapshot_date::timestamptz + interval '12 hours'))*1000 as at_ms
         from view_snapshots s
        where s.video_id = any($1) and s.days_since_published between 27 and 33 and s.view_count > 0
        order by s.video_id, abs(s.days_since_published - 30)`,
      [group]
    );
    for (const r of rows) out.set(r.video_id, { v30: Number(r.view_count), day: Number(r.day), at: Number(r.at_ms) });
  }
  return out;
}

// ---------------------------------------------------------------- population
log(`population: long-form videos published in the last ${MONTHS} months with a day-27..33 truth and an early reading`);
const pop: { id: string; channel_id: string; pub: number }[] = (await q(
  `select v.id, v.channel_id, extract(epoch from v.published_at)*1000 as pub
     from videos v
    where v.published_at > now() - ($1 || ' months')::interval
      and ${longformSql('v')} and coalesce(v.privacy_status,'public') = 'public'
      and exists (select 1 from view_snapshots s
                   where s.video_id = v.id and s.days_since_published between 27 and 33 and s.view_count > 0)
      -- and at least one reading inside the first 14 days: a video we only ever saw once, at
      -- day 30, cannot be replayed at any age and is not what the hourly scorer works on either.
      and exists (select 1 from view_snapshots s
                   where s.video_id = v.id and s.days_since_published <= 14 and s.view_count > 0)`,
  [MONTHS]
)).map((r: any) => ({ id: r.id, channel_id: r.channel_id, pub: Number(r.pub) }));
log(`population: ${pop.length} videos`);

const pubs = pop.map((v) => v.pub).sort((a, b) => a - b);
const TIME_CUT = pubs[Math.floor((1 - TIME_FRAC) * (pubs.length - 1))];
log(`time cut: ${new Date(TIME_CUT).toISOString()} (last ${TIME_FRAC * 100}% of the window by publish date)`);

const isHeld = (id: string) => heldOut(id, HOLDOUT_SHARE);
const splitOf = (v: { id: string; pub: number }): string[] => {
  const s: string[] = [];
  if (isHeld(v.id)) s.push('heldout');
  if (v.pub > TIME_CUT) s.push('time');
  return s;
};
const trainPop = pop.filter((v) => !isHeld(v.id) && v.pub <= TIME_CUT);
const testPop = pop.filter((v) => splitOf(v).length > 0);
log(`train ${trainPop.length}  test ${testPop.length} (heldout ${testPop.filter((v) => isHeld(v.id)).length}, time ${testPop.filter((v) => v.pub > TIME_CUT).length})`);

// -------------------------------------------------------------- refit params
const stored: GlobalParams = (await q(
  `select params from score_params where model_version = $1 order by fitted_at desc limit 1`, [PARAMS_VERSION]
))[0].params;
log(`stored params (long tail + launch ladder) from score_params model_version=${PARAMS_VERSION}`);

const shuffle = <T,>(xs: T[], seed = 42): T[] => {
  const a = [...xs]; let s = seed;
  for (let i = a.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const fitIds = shuffle(trainPop).slice(0, FIT_SAMPLE).map((v) => v.id);
log(`refit: ${fitIds.length} train videos (core.fitParams, the production fitter)`);
const fitRows: FitRow[] = [];
for (const group of chunk(fitIds, 2000)) {
  const [rec, truth] = await Promise.all([records(group), day30(group)]);
  for (const id of group) {
    const t = truth.get(id); const snaps = rec.get(id);
    if (!t || !snaps) continue;
    for (const b of DAY_BUCKETS) {
      if (b >= 30) continue;
      const tol = b <= 3 ? 1 : b <= 7 ? 2 : 3;
      const near = snaps.filter((s) => Math.abs(s.day - b) <= tol).sort((p, r) => Math.abs(p.day - b) - Math.abs(r.day - b))[0];
      if (!near) continue;
      fitRows.push({ bucket: b, vt: near.views, v30: t.v30, q: growthExponent(snaps.filter((s) => s.day <= near.day + 1e-9)) });
    }
  }
  log(`  refit rows ${fitRows.length}`);
}
const params: GlobalParams = fitParams(fitRows);
params.longtail = stored.longtail;
// The hour ladder is fitted from live launch samples, none of which have a day-30 truth yet, so
// it cannot be refit from train rows. Carried over; it only affects the sub-day buckets.
for (const [k, v] of Object.entries(stored.mult)) if (Number(k) < 1) params.mult[Number(k)] = v as number;
log(`refit: mult=${JSON.stringify(Object.fromEntries(Object.entries(params.mult).map(([k, v]) => [k, Number(Math.exp(v as number).toFixed(2))])))}`);

// ------------------------------------------------------------------ test data
const testIds = shuffle(testPop, 7).slice(0, TEST_LIMIT).map((v) => v.id);
const testById = new Map(testPop.map((v) => [v.id, v]));
log(`replay: ${testIds.length} test videos`);

const priorRows: { video_id: string; prior_id: string; ppub: number }[] = [];
for (const group of chunk(testIds, 500)) {
  priorRows.push(...(await q(
    `select r.id as video_id, p.id as prior_id, extract(epoch from p.published_at)*1000 as ppub
       from unnest($1::text[]) as r(id) join videos v on v.id = r.id
       join lateral (select p.id, p.published_at from videos p
                      where p.channel_id = v.channel_id and p.published_at < v.published_at
                        and ${longformSql('p')}
                        and coalesce(p.privacy_status,'public') = 'public' and coalesce(p.view_count,0) > 0
                      order by p.published_at desc limit ${PRIOR_WINDOW}) p on true`,
    [group]
  )) as any[]);
}
const priorsOf = new Map<string, { id: string; pub: number }[]>();
for (const r of priorRows) {
  if (!priorsOf.has(r.video_id)) priorsOf.set(r.video_id, []);
  priorsOf.get(r.video_id)!.push({ id: r.prior_id, pub: Number(r.ppub) });
}
const priorIds = [...new Set(priorRows.map((r) => r.prior_id))];
log(`priors: ${priorIds.length} distinct`);

const [testRec, testTruth] = await Promise.all([records(testIds), day30(testIds)]);
const [priorRec, priorTruth] = await Promise.all([records(priorIds), day30(priorIds)]);
log(`records loaded`);

// -------------------------------------------------------------- packaging log
// Thumbnail swaps (a real version, not the first capture), non-backfill title edits, and the
// watcher's own feed events. Coverage starts 2026-09-01; before that a swap is invisible.
const pkgRows = await q(
  `with pkg as (
     select video_id, 'thumbnail_change' as type, first_seen as at from thumbnail_versions where version >= 2 and video_id = any($1)
     union all
     select video_id, 'title_change', first_seen from title_versions where version >= 2 and coalesce(backfill,false) = false and video_id = any($1)
     union all
     select video_id, type, at from feed_events where type in ('thumbnail_change','ab_rotation','title_change') and video_id = any($1))
   select p.video_id, p.type, extract(epoch from (p.at - v.published_at))/86400.0 as age
     from pkg p join videos v on v.id = p.video_id where p.at >= v.published_at`,
  [testIds]
);
const pkgOf = new Map<string, PackagingChange[]>();
for (const r of pkgRows) {
  if (!pkgOf.has(r.video_id)) pkgOf.set(r.video_id, []);
  pkgOf.get(r.video_id)!.push({ type: r.type, age: Number(r.age) });
}
// de-duplicate: the versions table and the feed event record the same swap
for (const [k, cs] of pkgOf) {
  const seen: PackagingChange[] = [];
  for (const c of cs.sort((a, b) => a.age - b.age)) {
    if (seen.some((s) => s.type === c.type && Math.abs(s.age - c.age) < 0.02)) continue;
    seen.push(c);
  }
  pkgOf.set(k, seen);
}
const COVER_MS = new Date(`${PACKAGING_COVERAGE_START}T00:00:00Z`).getTime();
log(`packaging: ${pkgRows.length} raw events on ${pkgOf.size} test videos`);

// ------------------------------------------------------------------- replay
/** The channel baseline and growth history as of wall-clock T -- nothing later is visible. */
function channelAsOf(vid: string, T: number, bucket: number) {
  const all = priorsOf.get(vid) ?? [];
  const pub = testById.get(vid)!.pub;
  const fresh = all.filter((p) => (pub - p.pub) / DAY <= PRIOR_STALE_DAYS);
  // v4.0: the baseline sees the whole fresh pool (age-weighted); est30 keeps the v3 window.
  const estWindow = priorWindow(publishGapDays(fresh.map((p) => p.pub)));
  const pool = fresh;
  const tol = bucketTolerance(bucket);
  const priorMultLogs: number[] = []; const priorV30: number[] = []; const priorAgeDays: number[] = []; const priorSameAge: number[] = [];
  let fromLifetime = 0, projected = 0;
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i];
    const obs = (priorRec.get(p.id) ?? []).filter((o) => o.at <= T);
    const tr = priorTruth.get(p.id);
    const realV30 = tr && tr.at <= T ? tr.v30 : null;      // day-30 not yet observable => hidden
    const latest = obs.length ? obs[obs.length - 1] : null;
    const est = corePriorV30(realV30, latest, params);
    if (est) {
      priorV30.push(est.v30); priorAgeDays.push((pub - p.pub) / DAY);
      if (est.kind === 'lifetime') fromLifetime++; if (est.kind === 'projected') projected++;
    }
    if (i < estWindow && obs.length) {
      const nearB = obs.filter((o) => Math.abs(o.day - bucket) <= tol).sort((a, b) => Math.abs(a.day - bucket) - Math.abs(b.day - bucket))[0];
      if (nearB && realV30) priorMultLogs.push(Math.log(realV30 / nearB.views));
    }
  }
  return { priorMultLogs, priorV30, priorAgeDays, priorSameAge, fromLifetime, projected, pool };
}

const rows: BenchRow[] = [];
const liftRows: LiftRow[] = [];
const buckets = fittedBuckets(params);

for (const vid of testIds) {
  const v = testById.get(vid)!;
  const truth = testTruth.get(vid);
  const obsAll = testRec.get(vid);
  if (!truth || !obsAll?.length) continue;
  const splits = splitOf(v);
  const packaging = pkgOf.get(vid) ?? [];
  const packagingCoverage = v.pub >= COVER_MS ? 'full' : 'none';

  for (const t of AGES) {
    const tol = tolFor(t);
    const near = obsAll.filter((o) => Math.abs(o.day - t) <= tol && o.day <= truth.day)
      .sort((a, b) => Math.abs(a.day - t) - Math.abs(b.day - t))[0];
    if (!near) continue;
    const T = near.at;
    const upto: Snapshot[] = obsAll.filter((o) => o.at <= T).map((o) => ({ day: o.day, views: o.views }));
    const bucket = bucketFor(near.day, buckets);
    const ch = channelAsOf(vid, T, bucket);
    const out = scoreVideo({
      vt: near.views, day: near.day, snaps: upto,
      priorMultLogs: ch.priorMultLogs, priorV30: ch.priorV30, priorAgeDays: ch.priorAgeDays, priorSameAge: ch.priorSameAge,
      priorsFromLifetime: ch.fromLifetime, priorsProjected: ch.projected, params,
    });
    for (const split of splits) {
      rows.push({
        videoId: vid, channelId: v.channel_id, split, t, day: near.day,
        est30: out.est30, actual30: truth.v30, baseline: out.baseline, score: out.score,
        confidence: out.confidence, q: out.q, nBaseline: out.nBaseline,
        priorsDerived: ch.fromLifetime + ch.projected,
        truthDay: truth.day, packaging, packagingCoverage,
      });
    }
  }

  // packaging lift: the forecast made from the record strictly before each change
  for (const c of packaging) {
    if (!(c.age > 0) || c.age >= truth.day) continue;
    const before = obsAll.filter((o) => o.day < c.age);
    if (!before.length) continue;
    const last = before[before.length - 1];
    const bucket = bucketFor(last.day, buckets);
    const ch = channelAsOf(vid, last.at, bucket);
    const out = scoreVideo({
      vt: last.views, day: last.day, snaps: before.map((o) => ({ day: o.day, views: o.views })),
      priorMultLogs: ch.priorMultLogs, priorV30: ch.priorV30, priorAgeDays: ch.priorAgeDays, priorSameAge: ch.priorSameAge, params,
    });
    if (out.est30 > 0) {
      liftRows.push({ videoId: vid, type: c.type, changeAge: c.age, forecastBefore: out.est30, actual30: truth.v30, lift: truth.v30 / out.est30 });
    }
  }
}
log(`replay: ${rows.length} (video, age, split) rows; ${liftRows.length} packaging-lift rows`);

// -------------------------------------------------------------------- output
const today = new Date().toISOString().slice(0, 10);
const notes = [
  `Params refit here from ${fitRows.length} (video, bucket) train rows via core.fitParams; the long-tail and sub-day (launch ladder) tables were carried over from the stored score_params fit because neither can be refit from train rows alone.`,
  `PACKAGING COVERAGE CAVEAT: thumbnail/title change history only exists for videos published on or after ${PACKAGING_COVERAGE_START} — the CDN watcher's first-capture pass ran that day, and before it a swap left no record. For every pre-Sep-1 video \`no_change\` means "no change we observed" and silently includes unseen swaps, so pooled and no_change are effectively the same number on the historical baseline. The first cohort with complete swap coverage AND a day-30 outcome arrives ~2026-10-01; the per-cell \`cov full/none\` counts show it landing.`,
  `OPEN FINDING — the sub-day forecast, and two code paths that disagree below day 1. The band fit of 2026-09-03 (lib/scoring/bands.ts FITTED_BANDS_2026_09_03) has q50 = +0.2016 at the 0.5-day bucket and +0.0914 at day 1, i.e. log(actual / forecast): the forecast it measures runs ~22% LOW at half a day, ~10% low at day 1, and is unbiased from day 2 on. THIS BENCHMARK measures the opposite sign at half a day — bias (median log(est30/actual30)) = +0.183 heldout / +0.159 time at t=0.5, i.e. ~18% HIGH. Both are correct about different code. scripts/fit-forecast-bands.ts and scripts/check-band-calibration.ts forecast with core.logMultTo30, which interpolates the DAY_BUCKETS only and clamps to the day-1 multiplier (~2.4x) for any age below one day; scoreVideo forecasts with bucketFor + the fitted launch ladder, which applies ~3.18x at half a day. The ladder over-corrects on this population by about as much as clamping under-corrects. Benchmark cells that move when this is settled: bias at t=0.5 (both splits) toward 0, then medALE at t=0.5 (today .567 heldout / .408 time — by far the worst ages in the table) and t=1. Fixing logMultTo30 to consult the launch ladder would also change every projected prior younger than a day, so it must be judged on the t=0.5..3 outlier cells too, not on bias alone. n at t=0.5 is small (23 heldout / 68 time) because sub-day readings today come only from a daily snapshot that happened to land inside the first 24 hours; 5-minute sampling began 2026-09-01 and no sampled video has a day-30 truth yet.`,
  `RECONCILIATION vs the Python harness (harness-v2/baseline_v3.csv). Harness baseline v3 medALE on its time split: .296/.232/.187/.138/.105/.049 at t=1/2/3/5/7/14, F1 .737/.740/.788/.826/.888/.957. This benchmark on its time split: .334/.231/.192/.142/.100/.037, F1 .521/.642/.710/.792/.864/.908. Point error agrees within noise from t=2 on and is worse at t=1; F1 is 10-20 points lower everywhere. Three causes, none of them a bug: (1) DIFFERENT MODEL — harness baseline v3 is an unfitted geometric mean of three round-3 entrants, while production v3.0 is that mechanism rewritten as one function (channel multiplier shrunk by n/(n+k) + a Q-quintile residual). The harness CHAMPION, which is what production is closest to, scored .387 at t=1; production sits between the two. (2) DIFFERENT BASELINE POPULATION — the harness only let a prior into base{t} if its day-30 was actually measured, and required 3 such priors, so 37% of its t=1 rows had no baseline at all and were dropped from P/R/F1. Production accepts a prior's day-30 PROJECTED forward or normalised down the long tail (core.priorV30), which is what lifted baseline coverage from ~50% to ~99% in scripts/backtest-baseline.ts. Measured here: 86% of this run's rows have a baseline, and the median row's baseline is built from 87% derived priors; only 32 time-split rows at t=7 have a majority-measured baseline, and on those F1 is 1.00 against 0.864 pooled. The F1 gap is the price of coverage, not a worse forecast. (3) DIFFERENT DATA AND SPLITS — the harness ran a 2025 Jul-Sep dense window with a 30%-of-channels holdout; this runs an 18-month window restricted to videos with a reading inside their first 14 days, with bands.heldOut's 1/16-of-videos holdout (which does NOT hold out a channel, so a channel's other videos can be in the fit) and a publish-date cut at ${new Date(TIME_CUT).toISOString().slice(0, 10)}. t=14 is better here (.037 vs .049) for the same reason: this population is the densely tracked one.`,
  `Outlier truth uses the SAME walk-forward baseline as the call (actual30 / baseline_t >= 2), so precision/recall measure the forecast, not the baseline. scripts/backtest-baseline.ts is the counterpart that measures the baseline.`,
];
const config = {
  populationRule: 'long-form, public, day-27..33 truth, >=1 reading within the first 14 days',
  months: MONTHS, timeCut: new Date(TIME_CUT).toISOString(), timeFrac: TIME_FRAC,
  holdoutShare: HOLDOUT_SHARE, population: pop.length, trainPop: trainPop.length,
  testPop: testPop.length, testSampled: testIds.length, fitSample: fitIds.length, fitRows: fitRows.length,
  ages: AGES, storedParamsFittedAt: stored.fittedAt, refitMult: params.mult,
};
const rep = buildReport(rows, { modelVersion: MODEL_VERSION, ages: AGES, splits: SPLITS, config, notes, lift: liftRows });

fs.mkdirSync(OUT_DIR, { recursive: true });
const stem = `${MODEL_VERSION}${PARAMS_VERSION === MODEL_VERSION ? '' : `-p${PARAMS_VERSION}`}-${today}`;
fs.writeFileSync(path.join(OUT_DIR, `${stem}.json`), JSON.stringify(rep, null, 2));
fs.writeFileSync(path.join(OUT_DIR, `${stem}.md`), reportMarkdown(rep));
// Per-row dump, so a later run can be compared on exactly the same videos.
fs.writeFileSync(
  path.join(OUT_DIR, `${stem}.rows.csv`),
  ['video_id,channel_id,split,t,day,truth_day,est30,actual30,baseline,score,confidence,q,n_baseline,priors_derived,coverage,changed']
    .concat(rows.map((r) => [
      r.videoId, r.channelId, r.split, r.t, r.day.toFixed(4), r.truthDay, r.est30.toFixed(2), r.actual30,
      r.baseline ?? '', r.score ?? '', r.confidence, r.q ?? '', r.nBaseline ?? '', r.priorsDerived ?? '', r.packagingCoverage,
      r.packaging.some((c) => c.age > r.day && c.age <= r.truthDay) ? 1 : 0,
    ].join(','))).join('\n')
);
if (WRITE_BASELINE) {
  fs.writeFileSync(path.join(OUT_DIR, 'BASELINE.json'), JSON.stringify({
    modelVersion: MODEL_VERSION, run: `${stem}.json`, rows: `${stem}.rows.csv`, recordedAt: new Date().toISOString(),
  }, null, 2));
  log(`BASELINE.json -> ${stem}.json`);
}
log(`wrote ${path.join(OUT_DIR, stem)}.{json,md,rows.csv}`);
console.log(reportMarkdown(rep));
await pool.end();
