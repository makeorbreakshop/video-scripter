// Model v5 scorer with versioned RSS observation contract. Direct Postgres only.
//   npx tsx scripts/score-videos.ts --fit        refit global params from the last 12 months (nightly)
//   npx tsx scripts/score-videos.ts [--all]      score videos published <=60d whose latest snapshot/sample
//                                                is newer than their stored score (hourly); --all covers all ages
//   --all --force                             explicitly rewrite every selected row; not for resumable loops
//   npx tsx scripts/score-videos.ts --final      one-shot final score for videos older than 60 days
//   npx tsx scripts/score-videos.ts --since 3    rescore every video published in the last 3 days
// Common flags: --channels <id,id>  restrict to those channels; --limit <n>  cap the target list.
//
// Baselines: a prior video's day-30 views come from its day-27..33 snapshot when it has one,
// otherwise (age >= 45d) from its current lifetime count divided back down the fitted long-tail
// curve. That is what lets sparsely tracked channels get a baseline at all.
// Reads: videos, view_snapshots, view_samples, rss_samples, score_params. Writes: video_scores, score_params (--fit).
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { longformSql } from '../lib/scoring/longform';
import { refreshScoredChannels } from '../lib/scoring/channel-refresh';
import { revalidateRemote } from '../lib/app/revalidate-remote';

import { chunk } from '../lib/nightly/tracking-core';
import {
  scoreVideo, fitParams, fitLongTail, estimateV30, longtailAt, bucketFor, growthExponent,
  median, GlobalParams, LongtailRow, MODEL_VERSION, Snapshot, FitRow, DAY_BUCKETS, MIN_LIFETIME_AGE,
  priorV30, publishGapDays, priorWindow, PRIOR_WINDOW, PRIOR_STALE_DAYS, channelBaseline, type PriorEstimate,
  fitLaunchLadder, fittedBuckets, bucketTolerance, HOUR_BUCKETS, type LaunchRow,
} from '../lib/scoring/core';
import {
  fitPast30, PAST30_AGES, fitLaunchLadderV5, LAUNCH_MIN_ROWS, LAUNCH_FIT_SINCE, AGE_FLOOR_HOURS,
  type TailPair, type LaunchRow5,
} from '../lib/scoring/growth';
import { scoreV5, type CurvePrior } from '../lib/scoring/curve';
import { historyInsert } from '../lib/scoring/history';
import fs from 'node:fs';
import { scoreRefreshSql } from '../lib/scoring/refresh-sql';
import { OBSERVATION_SCORE_VERSION, OBSERVATION_RECORDS_SQL, observationRecords } from '../lib/scoring/observations';
import { runScoringWorker, scoringTargetBatches } from '../lib/scoring/worker-runner';
import { incrementalScoreTargetsSql, walkIncrementalScoreTargets, type ScoreTargetCursorRow } from '../lib/scoring/target-selection';

const FIT = process.argv.includes('--fit');
const V5 = process.argv.includes('--v5');
const ALL = process.argv.includes('--all');
const FORCE = process.argv.includes('--force');
const FINAL = process.argv.includes('--final');
// Final rows are written once and never revisited; the version marks them so we can skip them.
const FINAL_VERSION = `${OBSERVATION_SCORE_VERSION}-final`;
const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const CHANNELS = (arg('--channels') ?? '').split(',').map((c) => c.trim()).filter(Boolean);
const LIMIT = Number(arg('--limit') ?? 0) || null;
// --since <days>: rescore EVERY video published within the last <days>, whether or not a new
// reading has landed since its stored score. The hourly pass only picks up videos with a fresh
// reading, so after a scoring-math fix the young rows would otherwise keep a stale number until
// their next snapshot. Added 2026-09-04 with the sub-day curve fix.
const SINCE = Number(arg('--since') ?? 0) || null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SLEEP_MS = Number(arg('--sleep') ?? 400);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 300000').catch(() => {}); });
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const q = async (sql: string, params?: any[]): Promise<any[]> => (await pool.query(sql, params)).rows as any[];

// Snapshot record for a set of videos: daily snapshots + high-res samples, as true-age days.
async function records(ids: string[]): Promise<Map<string, Snapshot[]>> {
  if (!ids.length) return new Map();
  // Fitting retains its approved paid-only input contract; RSS rollout does not refit v5.0.
  if (FIT) {
    const rows = await q(`select x.video_id, extract(epoch from (x.at - v.published_at))/86400.0 as day, x.views
      from (select video_id, snapshot_date::timestamptz + interval '12 hours' as at, view_count as views from view_snapshots where video_id = any($1)
        union all select video_id, sampled_at, view_count from view_samples where video_id = any($1)) x
      join videos v on v.id = x.video_id where x.views > 0 and x.at >= v.published_at order by x.video_id, x.at`, [ids]);
    const out = new Map<string, Snapshot[]>();
    for (const r of rows) {
      if (!out.has(r.video_id)) out.set(r.video_id, []);
      out.get(r.video_id)!.push({ day: Number(r.day), views: Number(r.views) });
    }
    return out;
  }
  const out = new Map<string, Snapshot[]>();
  // Bound each key array: very large IN sets can turn these reads into corpus-wide scans.
  for (const part of chunk(ids, 100)) {
    for (const [id, points] of observationRecords(await q(OBSERVATION_RECORDS_SQL, [part]))) out.set(id, points);
  }
  return out;
}

// Day-30 truth for a set of videos (snapshot at day 27..33 nearest 30), else null.
async function day30(ids: string[]): Promise<Map<string, number>> {
  const rows = await q(
    `select distinct on (video_id) video_id, view_count
       from view_snapshots where video_id = any($1) and days_since_published between 27 and 33 and view_count > 0
      order by video_id, abs(days_since_published - 30)`,
    [ids]
  );
  return new Map<string, number>(rows.map((r: any) => [r.video_id as string, Number(r.view_count)]));
}

// Current lifetime count + age (days) for a set of videos, for the long-tail fallback.
type Meta = { views: number; age: number };
async function meta(ids: string[]): Promise<Map<string, Meta>> {
  const rows = await q(
    `select id, coalesce(view_count,0) as views, extract(epoch from (now() - published_at))/86400.0 as age
       from videos where id = any($1)`,
    [ids]
  );
  return new Map<string, Meta>(rows.map((r: any) => [r.id as string, { views: Number(r.views), age: Number(r.age) }]));
}

// Day-30 views for a video: real snapshot, else lifetime normalized down the long-tail curve.
function v30Of(id: string, truth: Map<string, number>, metas: Map<string, Meta>, lt: GlobalParams['longtail']) {
  const m = metas.get(id);
  return estimateV30(truth.get(id) ?? null, m?.views ?? null, m?.age ?? 0, lt);
}

// Recent prior non-Short, non-live public videos of each target's channel, newest first.
// Fetches PRIOR_WINDOW and drops priors older than PRIOR_STALE_DAYS at the target's publish.
// This full pool is the v4.0 BASELINE pool (the age kernel handles staleness); the est30 side
// still narrows it to priorWindow(cadence) -- 15 normally, 10 on sparse channels. `ageDays` is
// the target's publish time minus the prior's, which is what the kernel weights by.
export interface Prior { id: string; pub: number; ageDays: number }
async function priorsFor(ids: string[]): Promise<Map<string, Prior[]>> {
  const rows: { video_id: string; prior_id: string; gap_days: number; pub: string }[] = await q(
    `select r.id as video_id, p.id as prior_id,
            extract(epoch from (v.published_at - p.published_at))/86400.0 as gap_days,
            p.published_at as pub
       from unnest($1::text[]) as r(id) join videos v on v.id = r.id
       join lateral (select p.id, p.published_at from videos p
                      where p.channel_id = v.channel_id and p.published_at < v.published_at
                        and ${longformSql('p')}
                        and coalesce(p.privacy_status,'public') = 'public' and coalesce(p.view_count,0) > 0
                      order by p.published_at desc nulls last limit ${PRIOR_WINDOW}) p on true
      order by r.id, p.published_at desc`,
    [ids]
  );
  const out = new Map<string, Prior[]>();
  for (const r of rows) {
    const ageDays = Number(r.gap_days);
    if (ageDays > PRIOR_STALE_DAYS) continue;
    if (!out.has(r.video_id)) out.set(r.video_id, []);
    out.get(r.video_id)!.push({ id: r.prior_id, pub: new Date(r.pub).getTime(), ageDays });
  }
  return out;
}

/** The est30 side keeps the v3 window: priorMultLogs / priorSameAge are unchanged by v4.0. */
function estPool(ps: Prior[]): Prior[] {
  return ps.slice(0, priorWindow(publishGapDays(ps.map((p) => p.pub))));
}

// Day-30 estimate for a prior: real snapshot, else its latest record translated along the
// fitted curve (down the long tail past day 30, up the growth curve before it).
function priorEstimate(pid: string, truth: Map<string, number>, recs: Map<string, Snapshot[]>, params: GlobalParams): PriorEstimate | null {
  const ps = recs.get(pid);
  const latest = ps?.length ? ps[ps.length - 1] : null;
  return priorV30(truth.get(pid) ?? null, latest, params);
}

async function fit() {
  log('fit: collecting videos published in the last 18 months with a day-30 truth');
  const vids = await q(
    `select distinct s.video_id from view_snapshots s join videos v on v.id = s.video_id
      where s.days_since_published between 27 and 33 and s.view_count > 0
        and v.published_at > now() - interval '18 months' and ${longformSql('v')}
      limit 60000`
  );
  const ids: string[] = vids.map((r: any) => r.video_id as string);
  log(`fit: ${ids.length} videos`);
  const fitRows: FitRow[] = [];
  for (const group of chunk(ids, 2000)) {
    const [rec, truth] = await Promise.all([records(group), day30(group)]);
    for (const id of group) {
      const v30 = truth.get(id); const snaps = rec.get(id);
      if (!v30 || !snaps) continue;
      for (const b of DAY_BUCKETS) {
        if (b >= 30) continue;
        const tol = b <= 3 ? 1 : b <= 7 ? 2 : 3;
        const near = snaps.filter((s) => Math.abs(s.day - b) <= tol).sort((p, q) => Math.abs(p.day - b) - Math.abs(q.day - b))[0];
        if (!near) continue;
        const upto = snaps.filter((s) => s.day <= near.day + 1e-9);
        fitRows.push({ bucket: b, vt: near.views, v30, q: growthExponent(upto) });
      }
    }
  }
  const params = fitParams(fitRows);
  params.longtail = await fitLongtailTable();
  // v5: prefer the snapshot-pair fit for the buckets it actually supports; fall back to the
  // lifetime-count table bucket by bucket so an unsupported age never loses its multiplier.
  // MEASURED 2026-09-04: a trailing 12-month window yields ZERO same-video (day-30, >=60d)
  // pairs. The snapshot store starts 2025-06-30, and every video whose day-30 reading is inside
  // the last year is either still under 60 days old or was not re-snapshotted past 60 yet; the
  // only pairs in the corpus come from the first weeks of tracking. So the window is widened
  // until pairs exist, and the fallback is logged rather than hidden -- the temporal claim in
  // the spec ("refit nightly from a trailing window") does not hold for the past-30 buckets yet.
  let pairs = await fitPast30Table(12);
  let pastMonths = 12;
  if (pairs.length < 100) { pairs = await fitPast30Table(120); pastMonths = 120; log(`fit: past-30 12-month window empty; widened to all time`); }
  const past = fitPast30(pairs);
  const lt0 = params.longtail;
  const merged = { ages: [...lt0.ages], mult: [...lt0.mult], n: [...lt0.n] };
  for (let i = 0; i < past.ages.length; i++) {
    const j = merged.ages.indexOf(past.ages[i]);
    if (j >= 0 && past.n[i] >= 20) { merged.mult[j] = past.mult[i]; merged.n[j] = past.n[i]; }
  }
  for (let i = 1; i < merged.mult.length; i++) merged.mult[i] = Math.max(merged.mult[i], merged.mult[i - 1], 1);
  params.longtail = merged;
  log(`fit: past-30 pairs (window ${pastMonths}mo) ${past.ages.map((a, i) => `${a}d x${past.mult[i].toFixed(3)} (n=${past.n[i]})`).join('  ')}`);
  // Launch ladder: hour buckets chained through day 1, fitted with growth.fitLaunchLadderV5 --
  // minRows 200, winsorised, and a starved bucket carries the younger one forward rather than
  // leaving a hole for logToRef to interpolate across.
  const launch = fitLaunchLadderV5(await launchRows(), params.mult[1] ?? 0);
  Object.assign(params.mult, launch.mult);
  (params as any).launch = {
    n: launch.n, fitted: launch.fitted, carried: launch.carried,
    minRows: LAUNCH_MIN_ROWS, since: LAUNCH_FIT_SINCE, fittedAt: new Date().toISOString(),
  };
  log(`fit: launch ladder ${HOUR_BUCKETS.map((b) => `${Math.round(b * 24)}h x${launch.mult[b] != null ? Math.exp(launch.mult[b]).toFixed(2) : '-'} (n=${launch.n[b]}${launch.carried.includes(b) ? ',carried' : ''})`).join('  ')}`);
  await pool.query(`insert into score_params (model_version, n_videos, params) values ($1, $2, $3)`, [MODEL_VERSION, ids.length, JSON.stringify(params)]);
  log(`fit: stored params from ${fitRows.length} (video, bucket) rows; mult=${JSON.stringify(Object.fromEntries(Object.entries(params.mult).map(([k, v]) => [k, Number(Math.exp(v).toFixed(2))])))}`);
  const lt = params.longtail;
  log(`fit: longtail ${lt.ages.map((a, i) => `${a}d x${lt.mult[i].toFixed(2)} (n=${lt.n[i]})`).join('  ')}`);
}

// Launch rows: (sample at hour h, reading at day 1) pairs on the same video.
//
// v3 drew these from videos published in the last 30 DAYS, which starved the early buckets --
// under 200 pairs in most of them, so `fitLaunchLadder`'s minRows=50 either fitted noise or
// skipped the bucket and let logToRef interpolate across the hole. That is the sub-day error.
//
// v5 draws from the whole LAUNCH-TRACKER ERA instead (LAUNCH_FIT_SINCE = 2026-08-01, when the
// 5/15/30-minute ladder started running). The hour-h side is view_samples only -- a snapshot is
// a date, not a time, and rounding one to noon inside the first day is the same fiction the old
// query used. The day-1 side accepts either source, because at 24h a snapshot's midday stamp is
// within the tolerance that matters.
async function launchRows(): Promise<LaunchRow5[]> {
  const rows = await q(
    `with lf as (
       select v.id, v.published_at from videos v
        where v.published_at >= $1::date and ${longformSql('v')}),
     samp as (
       select s.video_id, extract(epoch from (s.sampled_at - lf.published_at))/3600.0 as hours, s.view_count
         from view_samples s join lf on lf.id = s.video_id where s.view_count > 0),
     d1 as (
       select distinct on (video_id) video_id, view_count as v1 from (
         select video_id, hours, view_count from samp
         union all
         select s.video_id, extract(epoch from (s.snapshot_date::timestamptz + interval '12 hours' - lf.published_at))/3600.0, s.view_count
           from view_snapshots s join lf on lf.id = s.video_id where s.view_count > 0
       ) o where hours between 21 and 27 order by video_id, abs(hours - 24))
     select o.hours, o.view_count as vh, d1.v1
       from samp o join d1 on d1.video_id = o.video_id
      where o.hours > 0 and o.hours < 20`,
    [LAUNCH_FIT_SINCE]
  );
  log(`fit: launch ladder fed by ${rows.length} (view_samples, day-1) pairs since ${LAUNCH_FIT_SINCE}`);
  return rows.map((r: any) => ({ hours: Number(r.hours), vh: Number(r.vh), v1: Number(r.v1) }));
}

// Long-tail table: every video with BOTH a day-27..33 snapshot and a later view count at
// age >= 60d. Two sources of that later count, same estimand (views at age t / v30):
//   (a) the video's current lifetime view_count, at its current age;
//   (b) any stored view_snapshot at day >= 60.
// (b) matters because day-30 snapshots only exist for a narrow slice of publish dates, so
// (a) alone lands entirely in one age bucket and leaves the rest of the table unfit.
async function fitLongtailTable() {
  const rows = await q(
    `with base as (
       select distinct on (s.video_id) s.video_id, s.view_count as v30
         from view_snapshots s
        where s.days_since_published between 27 and 33 and s.view_count > 0
        order by s.video_id, abs(s.days_since_published - 30))
     select b.v30, v.view_count as later, extract(epoch from (now() - v.published_at))/86400.0 as age
       from base b join videos v on v.id = b.video_id
      where v.view_count > 0 and v.published_at < now() - interval '60 days'
        and ${longformSql('v')}
     union all
     select b.v30, l.view_count as later, l.days_since_published::float as age
       from base b
       join view_snapshots l on l.video_id = b.video_id and l.days_since_published >= 60 and l.view_count > 0
       join videos v on v.id = b.video_id
      where ${longformSql('v')}`
  );
  const ltRows: LongtailRow[] = rows.map((r: any) => ({ age: Number(r.age), v30: Number(r.v30), lifetime: Number(r.later) }));
  log(`fit: longtail fed by ${ltRows.length} (video, later-count) observations`);
  return fitLongTail(ltRows);
}


// v5: the past-30 half of G, fitted from SNAPSHOT PAIRS in a trailing 12-month window.
// Every (day-27..33 reading, later reading >= 60d) pair on the same video, bucketed by the later
// reading's age. Pairs, not lifetime counts: a lifetime count is read TODAY while the day-30
// reading is old, which mixes calendar time into what is supposed to be an age curve. The
// 12-month window is on the day-30 reading, so the table is temporal like the rest of the fit.
async function fitPast30Table(months: number): Promise<TailPair[]> {
  const rows = await q(
    `with base as (
       select distinct on (s.video_id) s.video_id, s.view_count as v30, s.snapshot_date as at30
         from view_snapshots s
         join videos v on v.id = s.video_id
        where s.days_since_published between 27 and 33 and s.view_count > 0
          and s.snapshot_date > (now() - ($1 || ' months')::interval)::date
          and ${longformSql('v')}
        order by s.video_id, abs(s.days_since_published - 30))
     select b.v30, l.view_count as later, l.days_since_published::float as later_age
       from base b
       join view_snapshots l on l.video_id = b.video_id
        and l.days_since_published >= 60 and l.view_count > 0`,
    [months]
  );
  log(`fit: past-30 fed by ${rows.length} (day-30, later-snapshot) pairs in the last ${months} months`);
  return rows.map((r: any) => ({ laterAge: Number(r.later_age), v30: Number(r.v30), later: Number(r.later) }));
}

// ---------------------------------------------------------------- writing a score
//
// v5 keeps `video_scores` as ONE ROW PER VIDEO -- the current answer, which every app read path
// joins without a model_version filter -- and adds `video_score_history`, which is append-only.
// The pair is written in the same batch, so "what the app says" and "how it got there" can never
// drift. See sql/score-history.sql.
//
// The v3/v4 column names are kept and remapped rather than left null, because the app, the API
// and the extension all read them:
//   score      -> the same-age ratio v(t)/C(t)   (this IS the score now)
//   baseline   -> C(30), the channel's typical at day 30 (the display anchor the channel chart
//                 and sparklines plot; unchanged in meaning from v4). C(t) is typical_at_age.
//   n_baseline -> priors that contributed to C(t)
//   est30      -> the projection at horizon 30   (was: the score's numerator)
// and the v5-only facts land in their own columns (sql/scoring-v5.sql).

const SCORE_COLUMNS = [
  'video_id', 'channel_id', 'model_version', 'snapshot_day', 'views', 'q', 'est30', 'baseline',
  'n_baseline', 'score', 'same_age_ratio', 'n_same_age', 'confidence', 'priors_from_lifetime',
  'age_days', 'typical_at_age', 'n_typical', 'typical_neff', 'typical_measured_share',
  'projection', 'projection_horizon',
] as const;

type ScoreRow = Record<(typeof SCORE_COLUMNS)[number], any>;
const scoredChannels = new Set<string>();

/** Current answer and history commit together. The read watermark leaves concurrently arriving evidence dirty. */
async function writeScores(rows: ScoreRow[], readStartedAt = new Date()) {
  if (!rows.length) return 0;
  const values: any[] = []; const tuples: string[] = [];
  for (const r of rows) {
    const i = values.length;
    for (const c of SCORE_COLUMNS) values.push(r[c] ?? null);
    values.push(readStartedAt);
    tuples.push(`(${SCORE_COLUMNS.map((_, k) => `$${i + k + 1}`).join(',')},$${values.length})`);
  }
  const set = SCORE_COLUMNS.filter((c) => c !== 'video_id')
    .map((c) => `${c}=excluded.${c}`).join(', ');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into video_scores (${SCORE_COLUMNS.join(', ')}, scored_at)
       values ${tuples.join(',')}
       on conflict (video_id) do update set ${set}, scored_at=excluded.scored_at`,
      values
    );
    const hist = historyInsert(rows.map((r) => ({
      video_id: r.video_id, channel_id: r.channel_id, model_version: r.model_version,
      age_days: r.age_days, views: r.views, score: r.score, same_age_ratio: r.same_age_ratio,
      typical_at_age: r.typical_at_age, n_typical: r.n_typical,
      typical_measured_share: r.typical_measured_share, projection: r.projection,
      projection_horizon: r.projection_horizon, est30: r.est30, baseline: r.baseline,
      n_baseline: r.n_baseline, confidence: r.confidence,
      extra: { params_version: MODEL_VERSION, observation_version: OBSERVATION_SCORE_VERSION, q: r.q, n_same_age: r.n_same_age, typical_neff: r.typical_neff, priors_from_lifetime: r.priors_from_lifetime },
    })));
    if (hist) await client.query(hist.text, hist.values);
    // Headline scores commit with the score/history batch, including partial/stopped runs.
    await refreshScoredChannels(client, rows.map(row => row.channel_id));
    await client.query('commit');
    for (const row of rows) if (row.channel_id) scoredChannels.add(row.channel_id);
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
  return rows.length;
}

/** scoreV5 output -> a video_scores row, with the legacy columns remapped (see above). */
function rowFromV5(
  id: string, channelId: string, version: string, views: number, o: ReturnType<typeof scoreV5>
): ScoreRow {
  const nReal = Math.round(o.nTypical * o.typicalMeasuredShare);
  return {
    video_id: id, channel_id: channelId, model_version: version,
    snapshot_day: o.ageDays, views, q: o.q,
    est30: o.projection, baseline: o.typicalAt30, n_baseline: o.nTypical,
    score: o.score, same_age_ratio: o.score, n_same_age: nReal, confidence: o.confidence,
    priors_from_lifetime: o.nTypical - nReal,
    age_days: o.ageDays, typical_at_age: o.typicalAtAge, n_typical: o.nTypical,
    typical_neff: o.typicalNeff, typical_measured_share: o.typicalMeasuredShare,
    projection: o.projection, projection_horizon: o.projectionHorizon,
  };
}

/**
 * Everything scoreV5 needs for one batch of targets, in four reads. Shared by --v5 (CSV) and the
 * write paths, so the dry run and production cannot answer differently.
 */
async function v5Batch(group: { id: string; channel_id: string }[], params: GlobalParams) {
  const ids = group.map((r) => r.id);
  const priorsOf = await priorsFor(ids);
  const priorIds: string[] = [...new Set([...priorsOf.values()].flat().map((pp) => pp.id))];
  const [rec, priorRec, priorMeta, truth] = await Promise.all([
    records(ids), records(priorIds), meta(priorIds), day30(priorIds),
  ]);
  const out: { t: { id: string; channel_id: string }; views: number; o: ReturnType<typeof scoreV5> }[] = [];
  for (const t of group) {
    const snaps = rec.get(t.id);
    if (!snaps?.length) continue;
    const latest = snaps[snaps.length - 1];
    const pool2 = priorsOf.get(t.id) ?? [];
    const curvePriors: CurvePrior[] = pool2.map((pp) => {
      const m = priorMeta.get(pp.id);
      return {
        id: pp.id, ageDays: pp.ageDays, samples: priorRec.get(pp.id) ?? [],
        lifetime: m && m.views > 0 ? { views: m.views, ageDays: m.age } : null,
      };
    });
    // the est30-side channel multiplier still feeds G's blend (unchanged from v3)
    const bucket = bucketFor(latest.day, fittedBuckets(params));
    const tol = bucketTolerance(bucket);
    const priorMultLogs: number[] = [];
    for (const pp of estPool(pool2)) {
      const ps = priorRec.get(pp.id); const v30 = truth.get(pp.id);
      if (!ps || !v30) continue;
      const nearB = ps.filter((sn) => Math.abs(sn.day - bucket) <= tol)
        .sort((a, b) => Math.abs(a.day - bucket) - Math.abs(b.day - bucket))[0];
      if (nearB) priorMultLogs.push(Math.log(v30 / nearB.views));
    }
    out.push({
      t, views: latest.views,
      o: scoreV5({ vt: latest.views, age: latest.day, snaps, priors: curvePriors, priorMultLogs, params }),
    });
  }
  return out;
}

async function loadParams(version = MODEL_VERSION): Promise<GlobalParams> {
  const p = await q(`select params from score_params where model_version = $1 order by fitted_at desc limit 1`, [version]);
  if (!p.length) { console.error(`no score_params for ${version}; run --fit first`); process.exit(1); }
  return p[0].params as GlobalParams;
}

// The hourly pass. Under 60 days, whichever videos got a reading newer than their stored score.
async function score(signal: AbortSignal) {
  const params = await loadParams();
  const chFilter = CHANNELS.length ? `and v.channel_id = any($1)` : '';
  const args = CHANNELS.length ? [CHANNELS] : [];
  const cap = LIMIT ? `limit ${LIMIT}` : '';
  // --all drops the 60-day ceiling: a same-age score has no reason to freeze, so the cadence
  // comes from the SNAPSHOT tiers (daily <30d, every 3d to 180d, weekly after), not the scorer.
  const bulkTargets: { id: string; channel_id: string }[] | null = SINCE || (ALL && FORCE) ? await q(
    SINCE
      ? `select v.id, v.channel_id from videos v
          where ${longformSql('v')} and coalesce(v.privacy_status,'public') = 'public' ${chFilter}
            and v.published_at > now() - interval '${SINCE} days'
          order by v.published_at desc ${cap}`
    : ALL && FORCE
      ? `select v.id, v.channel_id from videos v
          where ${longformSql('v')} and coalesce(v.privacy_status,'public') = 'public' ${chFilter}
          order by v.published_at desc ${cap}`
      : `select v.id, v.channel_id from videos v
          where ${longformSql('v')} and coalesce(v.privacy_status,'public') = 'public' ${chFilter}
          order by v.published_at desc ${cap}`,
    args
  ) : null;
  let written = 0, selected = 0, noCurve = 0, tooYoung = 0;
  const processTargets = async (targets: { id: string; channel_id: string }[]) => {
    for (const group of scoringTargetBatches(targets)) {
      if (signal.aborted) break;
      const readStartedAt = new Date();
      const batch = await v5Batch(group, params);
      for (const b of batch) { if (b.o.belowAgeFloor) tooYoung++; else if (b.o.score == null) noCurve++; }
      written += await writeScores(batch.map((b) => rowFromV5(b.t.id, b.t.channel_id, OBSERVATION_SCORE_VERSION, b.views, b.o)), readStartedAt);
      if (written % 1000 < 100) log(`score: ${written} written`);
      if (ALL) await sleep(SLEEP_MS);
    }
  };
  if (bulkTargets) {
    selected = bulkTargets.length;
    log(`score: ${selected} videos to score${SINCE ? ` (--since ${SINCE}d)` : ' (--all --force)'}`);
    await processTargets(bulkTargets);
  } else {
    selected = await walkIncrementalScoreTargets<ScoreTargetCursorRow>({
      limit: LIMIT ?? Number.MAX_SAFE_INTEGER,
      signal,
      fetchPage: async (cursor, limit) => {
        const query = incrementalScoreTargetsSql({ all: ALL, channels: CHANNELS, limit, cursor, version: OBSERVATION_SCORE_VERSION });
        return q(query.text, query.values);
      },
      onPage: processTargets,
    });
  }
  if (selected === 0) log(`score: 0 videos to score${ALL ? ' (--all: whole corpus)' : ''}`);
  log(`score: ${signal.aborted ? 'stopped' : 'done'}, ${selected} selected, ${written} scored (${noCurve} with no channel curve, ${tooYoung} under the ${AGE_FLOOR_HOURS}h floor)`);
}

// --final: videos past 60 days that the hourly pass does not select. Under v5 this is the same
// score at a later age -- there is no day-30 anchor to freeze against any more -- so it runs the
// identical math and only the version label and the pacing differ.
async function final(signal: AbortSignal) {
  const params = await loadParams();
  const chFilter = CHANNELS.length ? `and v.channel_id = any($1)` : '';
  const targets: { id: string; channel_id: string }[] = await q(
    `select v.id, v.channel_id from videos v
       left join video_scores sc on sc.video_id = v.id
      where v.published_at < now() - interval '60 days'
        and ${longformSql('v')} and coalesce(v.privacy_status,'public') = 'public'
        and coalesce(v.view_count,0) > 0 ${chFilter}
        and (sc.video_id is null or sc.model_version <> '${FINAL_VERSION}')
      order by v.published_at desc
      ${LIMIT ? `limit ${LIMIT}` : ''}`,
    CHANNELS.length ? [CHANNELS] : []
  );
  log(`final: ${targets.length} videos older than 60 days`);
  let written = 0, noCurve = 0;
  for (const group of scoringTargetBatches(targets)) {
    if (signal.aborted) break;
    const readStartedAt = new Date();
    const batch = await v5Batch(group, params);
    for (const b of batch) if (b.o.score == null) noCurve++;
    written += await writeScores(batch.map((b) => rowFromV5(b.t.id, b.t.channel_id, FINAL_VERSION, b.views, b.o)), readStartedAt);
    if (written % 5000 < 500) log(`final: ${written} written`);
    await sleep(SLEEP_MS);   // paced: this walks the long tail of the corpus
  }
  log(`final: ${signal.aborted ? 'stopped' : 'done'}, ${written} scored (${noCurve} with no channel curve)`);
}

// ---------------------------------------------------------------- v5 (--v5)
//
// score(t) = v(t) / C(t) at TRUE age, plus a projection along G at a chosen horizon.
//
// SELECTION. v4 froze a video at 60 days: the hourly pass had a `published_at > now() - 60 days`
// ceiling and `--final` wrote a one-shot row past it. A same-age score has no reason to freeze --
// day 30 is not special and neither is day 60 -- so v5 drops the ceiling and keeps the same
// "something newer than the stored score" predicate for every age. The cadence therefore comes
// from the SNAPSHOT tiers, not from the scorer: daily under 30d, every 3 days to 180d, weekly
// after. The hourly selection for <60d is unchanged; older videos simply stop being excluded.
//
// OUTPUT. A CSV under docs/benchmarks -- the dry run. It shares v5Batch with the write paths,
// so it cannot answer differently from what the hourly pass would store.
async function v5(signal: AbortSignal) {
  const params = await loadParams();
  const chFilter = CHANNELS.length ? `and v.channel_id = any($1)` : '';
  const args = CHANNELS.length ? [CHANNELS] : [];
  const cap = LIMIT ? `limit ${LIMIT}` : '';
  const AGE_CEIL = arg('--max-age-days');
  const ceil = AGE_CEIL ? `and v.published_at > now() - interval '${Number(AGE_CEIL)} days'` : '';
  const targets: { id: string; channel_id: string }[] = await q(
    ALL
      ? `select v.id, v.channel_id from videos v
          where ${longformSql('v')} and coalesce(v.privacy_status,'public') = 'public' ${ceil} ${chFilter}
          order by v.published_at desc ${cap}`
      : `select v.id, v.channel_id from videos v
          left join video_scores sc on sc.video_id = v.id
          where ${longformSql('v')} and coalesce(v.privacy_status,'public') = 'public' ${ceil} ${chFilter}
            and (sc.video_id is null
                 or exists (select 1 from rss_samples r where r.video_id = v.id and r.at > sc.scored_at and r.at <= now() and r.views >= 0)
                 or exists (select 1 from view_samples s where s.video_id = v.id and s.sampled_at > sc.scored_at)
                 or exists (select 1 from view_snapshots s where s.video_id = v.id and s.created_at > sc.scored_at))
          order by v.published_at desc ${cap}`,
    args
  );
  log(`v5: ${targets.length} videos to score (dry run, CSV out)`);

  const out = arg('--out') ?? `docs/benchmarks/v5.0-scores-${new Date().toISOString().slice(0, 10)}.csv`;
  fs.mkdirSync('docs/benchmarks', { recursive: true });
  const lines = ['video_id,channel_id,model_version,age_days,views,score,typical_at_age,n_typical,typical_neff,typical_measured_share,projection,projection_horizon,q,confidence'];
  let scored = 0, noCurve = 0;

  for (const group of scoringTargetBatches(targets)) {
    if (signal.aborted) break;
    for (const { t, views, o } of await v5Batch(group, params)) {
      if (o.score == null) noCurve++;
      scored++;
      lines.push([
        t.id, t.channel_id, OBSERVATION_SCORE_VERSION, o.ageDays.toFixed(4), views,
        o.score ?? '', o.typicalAtAge?.toFixed(2) ?? '', o.nTypical, o.typicalNeff.toFixed(3),
        o.typicalMeasuredShare.toFixed(4), o.projection.toFixed(2), o.projectionHorizon,
        o.q ?? '', o.confidence,
      ].join(','));
    }
    if (scored % 5000 < 500) log(`v5: ${scored} scored`);
    await sleep(SLEEP_MS);
  }
  fs.writeFileSync(out, lines.join('\n'));
  log(`v5: ${signal.aborted ? 'stopped, ' : ''}${scored} scored (${noCurve} with no channel curve) -> ${out}`);
}

try {
  await runScoringWorker({
    args: process.argv.slice(2),
    run: async (signal) => {
      if (FIT) await fit(); else if (V5) await v5(signal); else if (FINAL) await final(signal); else await score(signal);
        // The atomic batch already refreshed headlines. Invalidate every committed channel
      // even on a cooperative stop; otherwise clean scores can leave cached headlines stale.
      if (!FIT && !V5) await revalidateRemote({ channels: [...scoredChannels] });
    },
  });
} finally {
  await pool.end();
}
