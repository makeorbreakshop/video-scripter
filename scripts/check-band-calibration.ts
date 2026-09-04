// Are the forecast bands calibrated, or just narrower?
//
// For videos HELD OUT of the fit (bands.ts heldOut, same share the fitter used), take the
// record up to an age A, draw the band the video page would draw, and ask whether the real
// day-30 count fell inside. The inner ribbon claims half of videos; the outer claims four in
// five. Anything much below those numbers means the bands are lying.
//
//   npx tsx scripts/check-band-calibration.ts [--months 18] [--holdout 0.0625] [--target 500]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { longformSql } from '../lib/scoring/longform';
import { chunk } from '../lib/nightly/tracking-core';
import { MODEL_VERSION, logMultTo30, type GlobalParams } from '../lib/scoring/core';
import { expectedAt } from '../lib/admin/video-curve';
import {
  forecastBand, fitTrajectory, trajectoryFactor, tableFromRows, heldOut, BAND_AGES,
  TRAJECTORY_RMS_SCALE, TRAJECTORY_SPAN_FULL,
  type BandTable, type TrajectoryPoint,
} from '../lib/scoring/bands';

/** trajectoryFactor with a swept floor, so the constant can be chosen by measurement. */
function factorWithFloor(pts: TrajectoryPoint[], floor: number): number {
  const f = fitTrajectory(pts);
  if (f.n < 2 || !(f.spanDays > 0)) return 1;
  const quality = Math.exp(-f.rms / TRAJECTORY_RMS_SCALE);
  const span = Math.min(Math.max(f.spanDays / TRAJECTORY_SPAN_FULL, 0), 1);
  return 1 - (1 - floor) * quality * span;
}

const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const MONTHS = Number(arg('--months') ?? 18);
const HOLDOUT = Number(arg('--holdout') ?? 1 / 16);
const TARGET = Number(arg('--target') ?? 500);
/** Ignore the per-channel tables and score everything off the global fit (A/B for conditioning). */
const NO_CHANNEL = process.argv.includes('--no-channel');
/** Ignore the trajectory factor (A/B for the tightening). */
const NO_TRAJECTORY = process.argv.includes('--no-trajectory');
/** Override the trajectory floor, to sweep it against held-out coverage. */
const FLOOR = arg('--floor') != null ? Number(arg('--floor')) : null;
/** Terse one-line output, for sweeps. */
const BRIEF = process.argv.includes('--brief');
/**
 * Which stored score_params row to read the fitted bands and multipliers from. Defaults to this
 * build's MODEL_VERSION. A candidate whose `--fit` row has no bands yet (fit-forecast-bands is a
 * separate job) points this at the champion's version: the bands measure `logMultTo30`, which a
 * baseline-only change does not touch.
 */
const PARAMS_VERSION = arg('--params-version') ?? MODEL_VERSION;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 600000').catch(() => {}); });
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const q = async (sql: string, params?: any[]) => (await pool.query(sql, params)).rows as any[];

// The nightly `--fit` rewrites score_params WITHOUT bands (fit-forecast-bands.ts is a separate
// job that writes its own row), so "the newest row for this version" is usually band-less and
// this check would exit before doing anything. Take the newest row that actually carries bands.
const p = await q(
  `select params, fitted_at from score_params where model_version=$1 and params ? 'bands'
    order by fitted_at desc limit 1`, [PARAMS_VERSION]
);
if (!p.length) { console.error(`no score_params row for ${PARAMS_VERSION} carries bands; run fit-forecast-bands first`); process.exit(1); }
const params: GlobalParams = p[0].params;
const globalBands: BandTable = (params as any).bands;
log(`bands from score_params model_version=${PARAMS_VERSION} fitted_at=${new Date(p[0].fitted_at).toISOString()}`);

const chRows = await q(`select channel_id, age_bucket, n, q10, q25, q50, q75, q90 from channel_forecast_bands`);
const chTables = new Map<string, BandTable>();
{
  const byCh = new Map<string, any[]>();
  for (const r of chRows) { const a = byCh.get(r.channel_id) ?? []; a.push(r); byCh.set(r.channel_id, a); }
  for (const [c, rs] of byCh) { const t = tableFromRows(rs); if (t) chTables.set(c, t); }
}
log(`${chTables.size} channels with their own band table`);

const vids = await q(
  `select distinct s.video_id from view_snapshots s join videos v on v.id = s.video_id
    where s.days_since_published between 27 and 33 and s.view_count > 0
      and v.published_at > now() - ($1 || ' months')::interval and ${longformSql('v')}`,
  [MONTHS]
);
const ids: string[] = vids.map((r) => r.video_id).filter((id) => heldOut(id, HOLDOUT));
log(`${ids.length} held-out videos with a day-30 truth`);

type Hit = { age: number; inner: boolean; outer: boolean; innerW: number; outerW: number; channel: boolean };
const hits: Hit[] = [];
let videos = 0;

for (const group of chunk(ids, 500)) {
  if (videos >= TARGET) break;
  const [obs, truth, meta] = await Promise.all([
    q(`select x.video_id, extract(epoch from (x.at - v.published_at))/86400.0 as day, x.views
         from (select video_id, snapshot_date::timestamptz + interval '12 hours' as at, view_count as views
                 from view_snapshots where video_id = any($1)
               union all
               select video_id, sampled_at, view_count from view_samples where video_id = any($1)) x
         join videos v on v.id = x.video_id
        where x.views > 0 and x.at >= v.published_at`, [group]),
    q(`select distinct on (video_id) video_id, view_count as v30 from view_snapshots
        where video_id = any($1) and days_since_published between 27 and 33 and view_count > 0
        order by video_id, abs(days_since_published - 30)`, [group]),
    q(`select v.id, v.channel_id, sc.baseline::float8 as baseline from videos v
        left join video_scores sc on sc.video_id = v.id where v.id = any($1)`, [group]),
  ]);
  const byVideo = new Map<string, { day: number; views: number }[]>();
  for (const r of obs) {
    const a = byVideo.get(r.video_id) ?? [];
    a.push({ day: Number(r.day), views: Number(r.views) });
    byVideo.set(r.video_id, a);
  }
  const v30 = new Map<string, number>(truth.map((r: any) => [r.video_id, Number(r.v30)]));
  const metas = new Map<string, any>(meta.map((r: any) => [r.id, r]));

  for (const [id, snaps] of byVideo) {
    if (videos >= TARGET) break;
    const t = v30.get(id);
    const m = metas.get(id);
    if (!t || !(t > 0) || !m) continue;
    snaps.sort((a, b) => a.day - b.day);
    const hasChannel = chTables.has(m.channel_id);
    const table = (!NO_CHANNEL && chTables.get(m.channel_id)) || globalBands;
    // Label by whether this video's channel HAS a table, so the two runs compare like with like.
    const usedChannel = hasChannel;
    // A baseline is only needed for the trajectory shape; without one, fall back to the fitted
    // growth curve alone (the scale cancels in the residual, so any positive baseline works).
    const baseline = m.baseline && m.baseline > 0 ? m.baseline : 1;
    let any = false;
    for (const a of BAND_AGES) {
      const tol = Math.min(Math.max(a * 0.25, 1 / 8), 2);
      // everything we would have known at age A — the record up to that point
      const upto = snaps.filter((s) => s.day <= a + tol);
      const near = upto.filter((s) => Math.abs(s.day - a) <= tol)
        .sort((x, y) => Math.abs(x.day - a) - Math.abs(y.day - a))[0];
      if (!near) continue;
      const last = upto[upto.length - 1];
      const forecast30 = last.views * Math.exp(logMultTo30(params, last.day));
      if (!(forecast30 > 0)) continue;
      const traj: TrajectoryPoint[] = upto.map((s) => ({
        day: s.day, views: s.views, expected: expectedAt(baseline, params.mult, s.day).expected,
      })).filter((x) => x.expected > 0);
      const factor = NO_TRAJECTORY ? 1 : FLOOR != null ? factorWithFloor(traj, FLOOR) : trajectoryFactor(traj);
      const b = forecastBand(forecast30, 30, last.day, table, factor);
      if (!b) continue;
      hits.push({
        age: a,
        inner: t >= b.inner[0] && t <= b.inner[1],
        outer: t >= b.outer[0] && t <= b.outer[1],
        innerW: Math.log(b.inner[1] / b.inner[0]),
        outerW: Math.log(b.outer[1] / b.outer[0]),
        channel: usedChannel,
      });
      any = true;
    }
    if (any) videos++;
  }
  log(`  ${videos} videos, ${hits.length} (video, age) checks`);
}

const pct = (xs: Hit[], k: 'inner' | 'outer') => (100 * xs.filter((h) => h[k]).length) / (xs.length || 1);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

if (BRIEF) {
  const ch2 = hits.filter((h) => h.channel), gl2 = hits.filter((h) => !h.channel);
  console.log(
    `floor=${FLOOR ?? 'default'} channel=${NO_CHANNEL ? 'off' : 'on'} traj=${NO_TRAJECTORY ? 'off' : 'on'}  ` +
    `ALL ${pct(hits, 'inner').toFixed(1)}/${pct(hits, 'outer').toFixed(1)}  ` +
    `ch-subset ${pct(ch2, 'inner').toFixed(1)}/${pct(ch2, 'outer').toFixed(1)}  ` +
    `global-subset ${pct(gl2, 'inner').toFixed(1)}/${pct(gl2, 'outer').toFixed(1)}`
  );
  await pool.end();
  process.exit(0);
}
console.log(`\nheld-out calibration — ${videos} videos, ${hits.length} (video, age) checks` +
            `${NO_CHANNEL ? '  [global bands only]' : ''}${NO_TRAJECTORY ? '  [no trajectory factor]' : ''}`);
console.log('target: inner (q25..q75) 50%, outer (q10..q90) 80%\n');
console.log(' age      n   inner%   outer%   mean inner width   mean outer width');
for (const a of BAND_AGES) {
  const xs = hits.filter((h) => h.age === a);
  if (!xs.length) continue;
  console.log(
    `${String(a).padStart(4)} ${String(xs.length).padStart(6)}   ` +
    `${pct(xs, 'inner').toFixed(1).padStart(6)}   ${pct(xs, 'outer').toFixed(1).padStart(6)}   ` +
    `${(Math.exp(mean(xs.map((h) => h.innerW))) - 1).toFixed(3).padStart(16)}   ` +
    `${(Math.exp(mean(xs.map((h) => h.outerW))) - 1).toFixed(3).padStart(16)}`
  );
}
console.log(`\nALL  ${String(hits.length).padStart(6)}   ${pct(hits, 'inner').toFixed(1).padStart(6)}   ${pct(hits, 'outer').toFixed(1).padStart(6)}`);
const ch = hits.filter((h) => h.channel), gl = hits.filter((h) => !h.channel);
if (ch.length) console.log(`  channel-conditioned  n=${ch.length}  inner ${pct(ch, 'inner').toFixed(1)}%  outer ${pct(ch, 'outer').toFixed(1)}%`);
if (gl.length) console.log(`  global fallback      n=${gl.length}  inner ${pct(gl, 'inner').toFixed(1)}%  outer ${pct(gl, 'outer').toFixed(1)}%`);
console.log();
await pool.end();
