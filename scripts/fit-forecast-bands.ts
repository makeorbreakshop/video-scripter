// Fit the chart's forecast band from the corpus and store it in score_params.params.bands.
//   npx tsx scripts/fit-forecast-bands.ts [--months 18] [--holdout 0.0625] [--dry]
//
// For every long-form video with a real day-27..33 snapshot, and an observation near each
// fitted age A, the residual is
//     resid = log(actual day-30 views) - log(v_A) - logMultTo30(params, A)
// i.e. log(actual / the day-30 forecast the page's curve would have made from that point.
// The page's forecast lands exactly on est30, and est30 = v_A * exp(remaining growth), so this
// is the forecast error at day 30 as a log ratio). lib/scoring/bands.ts takes the percentiles.
//
// Two fits from the same residuals:
//   global   -> ONE new score_params row: the current params, unchanged, plus a `bands` key.
//               The scorer reads the newest row, so its behaviour does not move.
//   channel  -> channel_forecast_bands, for every channel with at least MIN_CHANNEL_VIDEOS
//               day-30 videos, already shrunk toward the global fit by n (shrinkToGlobal).
// A deterministic share of videos is HELD OUT of both fits (bands.ts heldOut) so
// scripts/check-band-calibration.ts can measure coverage on videos neither fit has seen.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { longformSql } from '../lib/scoring/longform';
import { chunk } from '../lib/nightly/tracking-core';
import { MODEL_VERSION, logMultTo30, type GlobalParams } from '../lib/scoring/core';
import { fitBands, shrinkToGlobal, heldOut, BAND_AGES, QUANTILE_KEYS, SHRINK_K, MIN_CHANNEL_BUCKET_N, type BandRow, type BandTable } from '../lib/scoring/bands';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const MONTHS = Number(arg('--months') ?? 18);
const HOLDOUT = Number(arg('--holdout') ?? 1 / 16);
const DRY = process.argv.includes('--dry');
/** A channel needs this many day-30 videos before it gets its own row at all. */
const MIN_CHANNEL_VIDEOS = 8;
/** Multiplier on the shrinkage constant, so it can be chosen by held-out calibration. */
const SHRINK_SCALE = Number(arg('--shrink-scale') ?? 1);
/** Per-bucket evidence gate, swept against held-out calibration. */
const MIN_BUCKET_N = arg('--min-bucket-n') != null ? Number(arg('--min-bucket-n')) : MIN_CHANNEL_BUCKET_N;
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
/** Per channel: the same residuals, plus how many distinct videos they came from. */
const byChannel = new Map<string, { rows: BandRow[]; videos: Set<string> }>();
let withTruth = 0, held = 0;
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
  const chanOf = new Map<string, string>(
    (await q(`select id, channel_id from videos where id = any($1)`, [group])).map((r: any) => [r.id, r.channel_id])
  );
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
    // Held out of BOTH fits, so calibration is measured on videos neither has seen.
    if (heldOut(id, HOLDOUT)) { held++; continue; }
    withTruth++;
    const ch = chanOf.get(id) ?? null;
    for (const a of BAND_AGES) {
      const tol = tolFor(a);
      const near = snaps
        .filter((s) => Math.abs(s.day - a) <= tol && s.views > 0)
        .sort((x, y) => Math.abs(x.day - a) - Math.abs(y.day - a))[0];
      if (!near) continue;
      // the forecast the page would have drawn from this point, read at day 30
      const forecast30 = near.views * Math.exp(logMultTo30(params, near.day));
      if (!(forecast30 > 0)) continue;
      const row = { age: a, resid: Math.log(t / forecast30) };
      rows.push(row);
      if (ch) {
        let c = byChannel.get(ch);
        if (!c) { c = { rows: [], videos: new Set() }; byChannel.set(ch, c); }
        c.rows.push(row);
        c.videos.add(id);
      }
    }
  }
  log(`  ${withTruth} videos matched (${held} held out), ${rows.length} (video, age) residuals so far`);
}

const bands = fitBands(rows);
console.log('\nage      n       q10       q25       q50       q75       q90   inner  outer');
for (let i = 0; i < bands.ages.length; i++) {
  const inner = Math.exp(bands.q75[i]) - Math.exp(bands.q25[i]);
  const outer = Math.exp(bands.q90[i]) - Math.exp(bands.q10[i]);
  console.log(
    `${String(bands.ages[i]).padStart(4)} ${String(bands.n[i]).padStart(6)}  ` +
    QUANTILE_KEYS.map((k) => bands[k][i].toFixed(4).padStart(9)).join(' ') +
    `  ${inner.toFixed(3).padStart(5)}  ${outer.toFixed(3).padStart(5)}`
  );
}
console.log();

// ---- per channel ----------------------------------------------------------------------
// minRows 1 here, not 50: shrinkToGlobal is what protects a thin bucket, and it does it
// smoothly (w = n/(n+8)) instead of a cliff. fitBands' own carry-forward would hide the n.
const channelTables: Array<{ channelId: string; table: BandTable; videos: number }> = [];
for (const [channelId, c] of byChannel) {
  if (c.videos.size < MIN_CHANNEL_VIDEOS) continue;
  channelTables.push({ channelId, table: shrinkToGlobal(fitBands(c.rows, BAND_AGES, 1), bands, SHRINK_K * SHRINK_SCALE, MIN_BUCKET_N), videos: c.videos.size });
}
const widthOf = (t: BandTable, i: number) => Math.exp(t.q90[i]) - Math.exp(t.q10[i]);
const i5 = bands.ages.indexOf(5);
const narrower = channelTables.filter((c) => widthOf(c.table, i5) < widthOf(bands, i5)).length;
log(`channels: ${byChannel.size} seen, ${channelTables.length} with >= ${MIN_CHANNEL_VIDEOS} day-30 videos; ` +
    `${narrower} narrower than global at the day-5 bucket`);

if (DRY) { log('dry run: not written'); await pool.end(); process.exit(0); }
// The current params verbatim plus the band table: the scorer reads the newest row, so nothing
// it depends on moves.
const next = { ...params, bands };
await pool.query(
  `insert into score_params (model_version, n_videos, params) values ($1, $2, $3)`,
  [MODEL_VERSION, withTruth, JSON.stringify(next)]
);
log(`stored bands on a new ${MODEL_VERSION} score_params row from ${withTruth} videos / ${rows.length} residuals`);

// One statement per batch of channels rather than per row: 718 channels x 10 buckets.
let written = 0;
for (const batch of chunk(channelTables, 100)) {
  const vals: any[] = []; const tuples: string[] = [];
  for (const c of batch) {
    for (let i = 0; i < c.table.ages.length; i++) {
      const k = vals.length;
      vals.push(c.channelId, c.table.ages[i], c.table.n[i], ...QUANTILE_KEYS.map((q) => c.table[q][i]));
      tuples.push(`($${k + 1},$${k + 2},$${k + 3},$${k + 4},$${k + 5},$${k + 6},$${k + 7},$${k + 8},now())`);
    }
  }
  await pool.query(
    `insert into channel_forecast_bands (channel_id, age_bucket, n, q10, q25, q50, q75, q90, fitted_at)
     values ${tuples.join(',')}
     on conflict (channel_id, age_bucket) do update set
       n = excluded.n, q10 = excluded.q10, q25 = excluded.q25, q50 = excluded.q50,
       q75 = excluded.q75, q90 = excluded.q90, fitted_at = excluded.fitted_at`,
    vals
  );
  written += batch.length;
}
const cells = channelTables.reduce((a, c) => a + c.table.n.filter((n) => n >= MIN_BUCKET_N).length, 0);
log(`stored ${written} channel band tables (${written * BAND_AGES.length} rows), holdout ${HOLDOUT}, ` +
    `shrink x${SHRINK_SCALE}, gate n>=${MIN_BUCKET_N}: ${cells} of ${written * BAND_AGES.length} cells use the channel`);
await pool.end();
