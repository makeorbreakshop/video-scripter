// Fit the chart's forecast band from the corpus and store it in score_params.params.bands.
//   npx tsx scripts/fit-forecast-bands.ts [--months 18] [--dry]
//
// For every long-form video with a real day-27..33 snapshot, and an observation near each
// fitted age A, the residual is
//     resid = log(actual day-30 views) - log(v_A) - logMultTo30(params, A)
// i.e. log(actual / the day-30 forecast the page's curve would have made from that point.
// The page's forecast lands exactly on est30, and est30 = v_A * exp(remaining growth), so this
// is the forecast error at day 30 as a log ratio). lib/scoring/bands.ts takes the percentiles.
//
// Writes ONE new score_params row: the current params, unchanged, plus a `bands` key. The
// scorer reads the newest row, so its behaviour does not move.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { longformSql } from '../lib/scoring/longform';
import { chunk } from '../lib/nightly/tracking-core';
import { MODEL_VERSION, logMultTo30, type GlobalParams } from '../lib/scoring/core';
import { fitBands, BAND_AGES, type BandRow } from '../lib/scoring/bands';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const MONTHS = Number(arg('--months') ?? 18);
const DRY = process.argv.includes('--dry');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 600000').catch(() => {}); });
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const q = async (sql: string, params?: any[]) => (await pool.query(sql, params)).rows as any[];

const p = await q(`select params from score_params where model_version = $1 order by fitted_at desc limit 1`, [MODEL_VERSION]);
if (!p.length) { console.error('no score_params; run score-videos --fit first'); process.exit(1); }
const params: GlobalParams = p[0].params;

// Only videos that actually have a day-30 truth: everything else has nothing to be wrong about.
const vids = await q(
  `select distinct s.video_id from view_snapshots s join videos v on v.id = s.video_id
    where s.days_since_published between 27 and 33 and s.view_count > 0
      and v.published_at > now() - ($1 || ' months')::interval and ${longformSql('v')}`,
  [MONTHS]
);
const ids: string[] = vids.map((r) => r.video_id);
log(`${ids.length} videos with a real day-27..33 snapshot`);

// Tolerance around each fitted age: a quarter of the age, at least 3 hours, at most 2 days.
const tolFor = (a: number) => Math.min(Math.max(a * 0.25, 1 / 8), 2);

const rows: BandRow[] = [];
let withTruth = 0;
for (const group of chunk(ids, 2000)) {
  const [obs, truth] = await Promise.all([
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
  ]);
  const byVideo = new Map<string, { day: number; views: number }[]>();
  for (const r of obs) {
    const a = byVideo.get(r.video_id) ?? [];
    a.push({ day: Number(r.day), views: Number(r.views) });
    byVideo.set(r.video_id, a);
  }
  const v30 = new Map<string, number>(truth.map((r: any) => [r.video_id as string, Number(r.v30)]));
  for (const [id, snaps] of byVideo) {
    const t = v30.get(id);
    if (!t || !(t > 0)) continue;
    withTruth++;
    for (const a of BAND_AGES) {
      const tol = tolFor(a);
      const near = snaps
        .filter((s) => Math.abs(s.day - a) <= tol && s.views > 0)
        .sort((x, y) => Math.abs(x.day - a) - Math.abs(y.day - a))[0];
      if (!near) continue;
      // the forecast the page would have drawn from this point, read at day 30
      const forecast30 = near.views * Math.exp(logMultTo30(params, near.day));
      if (!(forecast30 > 0)) continue;
      rows.push({ age: a, resid: Math.log(t / forecast30) });
    }
  }
  log(`  ${withTruth} videos matched, ${rows.length} (video, age) residuals so far`);
}

const bands = fitBands(rows);
console.log('\nage      n        q10       q50       q90    exp(q10)  exp(q90)   spread');
for (let i = 0; i < bands.ages.length; i++) {
  const lo = Math.exp(bands.q10[i]), hi = Math.exp(bands.q90[i]);
  console.log(
    `${String(bands.ages[i]).padStart(4)}  ${String(bands.n[i]).padStart(6)}  ` +
    `${bands.q10[i].toFixed(4).padStart(9)} ${bands.q50[i].toFixed(4).padStart(9)} ${bands.q90[i].toFixed(4).padStart(9)}  ` +
    `${lo.toFixed(3).padStart(8)}  ${hi.toFixed(3).padStart(8)}  ${(hi - lo).toFixed(3).padStart(7)}`
  );
}
console.log();

if (DRY) { log('dry run: not written'); await pool.end(); process.exit(0); }
// The current params verbatim plus the band table: the scorer reads the newest row, so nothing
// it depends on moves.
const next = { ...params, bands };
await pool.query(
  `insert into score_params (model_version, n_videos, params) values ($1, $2, $3)`,
  [MODEL_VERSION, withTruth, JSON.stringify(next)]
);
log(`stored bands on a new ${MODEL_VERSION} score_params row from ${withTruth} videos / ${rows.length} residuals`);
await pool.end();
