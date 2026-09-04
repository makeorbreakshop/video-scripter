// v5 verification harness -- the 8-part design in
// ~/shared-memory/knowledge/projects/video-scripter/v5-same-age-score-spec.md.
//
//   npx tsx scripts/benchmark-v5.ts [--months 18] [--test-limit 1500] [--time-frac 0.2]
//                                   [--params-version v5.0] [--out docs/benchmarks]
//
// Truth exists wherever we have REAL samples, so every part below is measured against readings,
// never against another model's output. Everything is walk-forward: a prior's reading is visible
// only if its wall clock is at or before the target reading's.
//
// Parts (spec numbering):
//   1 interpolation (G) accuracy, leave-one-out
//   2 curve (C) accuracy: real-only vs interpolated, then censored vs centered oracle
//   3 score accuracy on rows where the ratio is fully measured
//   4 projection accuracy and band calibration
//   5 stability between adjacent readings
//   6 backfill fidelity (lifetime slid back to a later-observed real reading)
//   7 regression to v4 at t=30
//   8 gates -- reported, not computed here (see the leak query in the outlier-score skill)
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {
  MODEL_VERSION, PRIOR_WINDOW, PRIOR_STALE_DAYS, bucketFor, bucketTolerance, fittedBuckets,
  growthExponent, median, channelBaseline, priorV30 as corePriorV30,
  type GlobalParams, type Snapshot,
} from '../lib/scoring/core';
import { growthLog } from '../lib/scoring/growth';
import { channelCurve, contributionAt, sameAgeTolerance, scoreV5, project, type CurvePrior } from '../lib/scoring/curve';
import { heldOut, fitBands, bandAt, BAND_AGES } from '../lib/scoring/bands';
import { longformSql } from '../lib/scoring/longform';
import { medALE, bias, spearman, prf, distanceBucket, ageBucket, fmt } from '../lib/scoring/v5-metrics';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const MONTHS = Number(arg('--months') ?? 18);
const TEST_LIMIT = Number(arg('--test-limit') ?? 5000);
const TIME_FRAC = Number(arg('--time-frac') ?? 0.2);
const HOLDOUT_SHARE = Number(arg('--holdout') ?? 1 / 16);
const PARAMS_VERSION = arg('--params-version') ?? MODEL_VERSION;
const OUT_DIR = arg('--out') ?? 'docs/benchmarks';
const DAY = 86_400_000;
const SCORE_AGES = [0.5, 1, 2, 3, 5, 7, 14, 30, 90];
const HORIZONS = [7, 30, 90, 365];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 600000').catch(() => {}); });
const q = async (sql: string, params?: any[]): Promise<any[]> => (await pool.query(sql, params)).rows as any[];
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const chunk = <T,>(xs: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < xs.length; i += n) o.push(xs.slice(i, i + n)); return o; };
const shuffle = <T,>(xs: T[], seed = 42): T[] => {
  const a = [...xs]; let s = seed;
  for (let i = a.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

type Obs = { day: number; views: number; at: number };

/** Readings at TRUE age with their wall clock, batched by video_id (never a bare table scan). */
async function records(ids: string[]): Promise<Map<string, Obs[]>> {
  const out = new Map<string, Obs[]>();
  for (const group of chunk(ids, 2000)) {
    const rows = await q(
      `select x.video_id, extract(epoch from (x.at - v.published_at))/86400.0 as day, x.views,
              extract(epoch from x.at)*1000 as at_ms
         from (select video_id, snapshot_date::timestamptz + interval '12 hours' as at, view_count as views
                 from view_snapshots where video_id = any($1)
               union all
               select video_id, sampled_at, view_count from view_samples where video_id = any($1)) x
         join videos v on v.id = x.video_id
        where x.views > 0 and x.at >= v.published_at
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

type Meta = { views: number; age: number; pub: number; channel: string };
async function metaOf(ids: string[]): Promise<Map<string, Meta>> {
  const out = new Map<string, Meta>();
  for (const group of chunk(ids, 5000)) {
    for (const r of await q(
      `select id, coalesce(view_count,0) as views, channel_id,
              extract(epoch from (now() - published_at))/86400.0 as age,
              extract(epoch from published_at)*1000 as pub
         from videos where id = any($1)`, [group]
    )) out.set(r.id, { views: Number(r.views), age: Number(r.age), pub: Number(r.pub), channel: r.channel_id });
  }
  return out;
}

// ------------------------------------------------------------------ population
log(`population: long-form public videos published in the last ${MONTHS} months with at least one reading`);
const pop: { id: string; channel_id: string; pub: number }[] = (await q(
  `select v.id, v.channel_id, extract(epoch from v.published_at)*1000 as pub
     from videos v
    where v.published_at > now() - ($1 || ' months')::interval
      and ${longformSql('v')} and coalesce(v.privacy_status,'public') = 'public'
      and exists (select 1 from view_snapshots s where s.video_id = v.id and s.view_count > 0)
    order by v.id`,
  [MONTHS]
)).map((r: any) => ({ id: r.id, channel_id: r.channel_id, pub: Number(r.pub) }));
log(`population: ${pop.length} videos`);

const pubs = pop.map((v) => v.pub).sort((a, b) => a - b);
const TIME_CUT = pubs[Math.floor((1 - TIME_FRAC) * (pubs.length - 1))];
const isHeld = (id: string) => heldOut(id, HOLDOUT_SHARE);
const splitOf = (v: { id: string; pub: number }): string[] => {
  const s: string[] = [];
  if (isHeld(v.id)) s.push('heldout');
  if (v.pub > TIME_CUT) s.push('time');
  return s;
};
log(`time cut ${new Date(TIME_CUT).toISOString()}; heldout share ${HOLDOUT_SHARE}`);

const testIds = shuffle(pop, 7).slice(0, TEST_LIMIT).map((v) => v.id);
const testById = new Map(pop.map((v) => [v.id, v]));
log(`test: ${testIds.length} videos`);

// priors and followers: `pos < 0` is a prior (published before), `pos > 0` a follower.
const priorRows: any[] = [];
for (const group of chunk(testIds, 500)) {
  priorRows.push(...(await q(
    `select r.id as video_id, p.id as other_id, -1 as pos, extract(epoch from p.published_at)*1000 as opub
       from unnest($1::text[]) as r(id) join videos v on v.id = r.id
       join lateral (select p.id, p.published_at from videos p
                      where p.channel_id = v.channel_id and p.published_at < v.published_at
                        and ${longformSql('p')} and coalesce(p.privacy_status,'public') = 'public'
                        and coalesce(p.view_count,0) > 0
                      order by p.published_at desc limit ${PRIOR_WINDOW}) p on true
     union all
     select r.id, f.id, 1, extract(epoch from f.published_at)*1000
       from unnest($1::text[]) as r(id) join videos v on v.id = r.id
       join lateral (select f.id, f.published_at from videos f
                      where f.channel_id = v.channel_id and f.published_at > v.published_at
                        and ${longformSql('f')} and coalesce(f.privacy_status,'public') = 'public'
                        and coalesce(f.view_count,0) > 0
                      order by f.published_at asc limit 7) f on true`,
    [group]
  )));
}
type Neighbour = { id: string; pub: number; pos: number };
const neighboursOf = new Map<string, Neighbour[]>();
for (const r of priorRows) {
  if (!neighboursOf.has(r.video_id)) neighboursOf.set(r.video_id, []);
  neighboursOf.get(r.video_id)!.push({ id: r.other_id, pub: Number(r.opub), pos: Number(r.pos) });
}
const otherIds = [...new Set(priorRows.map((r: any) => r.other_id as string))];
log(`neighbours: ${otherIds.length} distinct (priors + up to 7 followers each)`);

const allIds = [...new Set([...testIds, ...otherIds])];
const [rec, metas] = await Promise.all([records(allIds), metaOf(allIds)]);
log(`records: ${rec.size} videos with readings`);

const stored = await q(`select params, fitted_at from score_params where model_version = $1 order by fitted_at desc limit 1`, [PARAMS_VERSION]);
if (!stored.length) { console.error(`no score_params for ${PARAMS_VERSION}; run scripts/score-videos.ts --fit`); process.exit(1); }
const params: GlobalParams = stored[0].params;
log(`params from score_params ${PARAMS_VERSION} fitted ${stored[0].fitted_at}`);
const BUCKETS = fittedBuckets(params);

// --------------------------------------------------------------- shared helpers
const obsOf = (id: string) => rec.get(id) ?? [];
/** A prior as the curve sees it, censored to wall clock T. */
function curvePrior(n: Neighbour, targetPub: number, T: number): CurvePrior {
  const samples = obsOf(n.id).filter((o) => o.at <= T).map((o) => ({ day: o.day, views: o.views }));
  const m = metas.get(n.id);
  // the lifetime count is read TODAY, so it is only visible to a walk-forward replay when the
  // replay clock is today; a historical replay sees it only through the samples above.
  const lifetimeVisible = T >= Date.now() - DAY;
  return {
    id: n.id, ageDays: (targetPub - n.pub) / DAY, samples,
    lifetime: lifetimeVisible && m && m.views > 0 ? { views: m.views, ageDays: m.age } : null,
  };
}
function priorsAsOf(vid: string, T: number, includeFollowers = false): CurvePrior[] {
  const pub = testById.get(vid)!.pub;
  return (neighboursOf.get(vid) ?? [])
    .filter((n) => (includeFollowers ? true : n.pos < 0))
    .filter((n) => Math.abs(pub - n.pub) / DAY <= PRIOR_STALE_DAYS)
    .map((n) => curvePrior(n, pub, T));
}
/** The reading nearest age t within tolerance, or null. */
function readingAt(obs: Obs[], t: number, tol = sameAgeTolerance(t)): Obs | null {
  const c = obs.filter((o) => Math.abs(o.day - t) <= tol).sort((a, b) => Math.abs(a.day - t) - Math.abs(b.day - t));
  return c[0] ?? null;
}

const tables: string[] = [];
const json: any = { modelVersion: MODEL_VERSION, paramsVersion: PARAMS_VERSION, generatedAt: new Date().toISOString(), config: { months: MONTHS, testLimit: TEST_LIMIT, timeCut: new Date(TIME_CUT).toISOString(), holdoutShare: HOLDOUT_SHARE, population: pop.length, tested: testIds.length }, parts: {} };

// ============================================================ 1. G accuracy (LOO)
log('part 1: leave-one-out interpolation accuracy');
type LooRow = { age: number; dist: number; pred: number; truth: number };
const loo: LooRow[] = [];
for (const id of allIds) {
  const obs = obsOf(id);
  if (obs.length < 4) continue;
  for (let i = 0; i < obs.length; i++) {
    const hidden = obs[i];
    if (!(hidden.day > 0) || !(hidden.views > 0)) continue;
    const rest = obs.filter((_, k) => k !== i).map((o) => ({ day: o.day, views: o.views }));
    const c = contributionAt({ ageDays: 0, samples: rest }, hidden.day, params);
    if (!c || c.kind !== 'interpolated') continue;   // 'real' would be a neighbour inside tolerance
    loo.push({ age: hidden.day, dist: c.logDistance, pred: c.views, truth: hidden.views });
  }
}
log(`part 1: ${loo.length} leave-one-out reconstructions`);
{
  const byAge = new Map<string, LooRow[]>();
  for (const r of loo) { const k = ageBucket(r.age); if (!byAge.has(k)) byAge.set(k, []); byAge.get(k)!.push(r); }
  const rowsA = [...byAge.entries()]
    .sort((a, b) => median(a[1].map((r) => r.age))! - median(b[1].map((r) => r.age))!)
    .map(([k, rs]) => ({ bucket: k, n: rs.length, medALE: medALE(rs.map((r) => [r.pred, r.truth] as [number, number])), bias: bias(rs.map((r) => [r.pred, r.truth] as [number, number])) }));
  const byDist = new Map<string, LooRow[]>();
  for (const r of loo) { const k = distanceBucket(r.dist); if (!byDist.has(k)) byDist.set(k, []); byDist.get(k)!.push(r); }
  const order = ['0 (measured)', '<=0.35 (~1 bucket)', '0.35-0.7', '0.7-1.4', '>1.4'];
  const rowsD = order.filter((k) => byDist.has(k)).map((k) => {
    const rs = byDist.get(k)!;
    return { bucket: k, n: rs.length, medALE: medALE(rs.map((r) => [r.pred, r.truth] as [number, number])), bias: bias(rs.map((r) => [r.pred, r.truth] as [number, number])) };
  });
  const near30 = loo.filter((r) => r.age <= 30 && r.dist <= 0.35);
  const gate = medALE(near30.map((r) => [r.pred, r.truth] as [number, number]));
  json.parts.g_accuracy = { byAge: rowsA, byDistance: rowsD, gate: { rule: 'medALE <= .10 within 30d at distance <= 1 bucket', n: near30.length, medALE: gate, pass: gate != null && gate <= 0.10 } };
  tables.push(
    `## 1. Interpolation (G) accuracy — leave-one-out\n\nEach real reading hidden in turn and rebuilt from the video's other readings via G. ` +
    `${loo.length} reconstructions over ${allIds.length} videos.\n\n### by target age\n\n| age bucket | n | medALE | bias |\n|---|--:|--:|--:|\n` +
    rowsA.map((r) => `| ${r.bucket} | ${r.n} | ${fmt(r.medALE)} | ${fmt(r.bias)} |`).join('\n') +
    `\n\n### by log-distance from the nearest visible reading\n\n| distance | n | medALE | bias |\n|---|--:|--:|--:|\n` +
    rowsD.map((r) => `| ${r.bucket} | ${r.n} | ${fmt(r.medALE)} | ${fmt(r.bias)} |`).join('\n') +
    `\n\n**Acceptance (spec):** medALE ≤ .10 within 30d for distance ≤ 1 bucket — n=${near30.length}, medALE ${fmt(gate)} → **${gate != null && gate <= 0.10 ? 'PASS' : 'FAIL'}**.\n`
  );
}

// ================================================== 2. curve accuracy (real vs modelled)
log('part 2: curve accuracy');
{
  const NOW = Date.now();
  type CRow = { t: number; modelled: number; realOnly: number; share: number };
  const rows2: CRow[] = [];
  type ORow = { t: number; censored: number; oracle: number };
  const rows2b: ORow[] = [];
  for (const vid of testIds) {
    const v = testById.get(vid)!;
    for (const t of [1, 3, 7, 30, 90]) {
      const all = priorsAsOf(vid, NOW);
      if (all.length < 3) continue;
      // real-only truth: priors that actually have a reading at t
      const realPriors = all.filter((p) => {
        const c = contributionAt(p, t, params);
        return c?.kind === 'real';
      });
      if (realPriors.length >= 3) {
        const cReal = channelCurve(realPriors, t, params);
        const cAll = channelCurve(all, t, params);
        if (cReal.typical && cAll.typical) rows2.push({ t, modelled: cAll.typical, realOnly: cReal.typical, share: cAll.measuredShare });
      }
      // censored (priors only, at the target's publish clock) vs centered oracle (priors + followers)
      const cens = channelCurve(priorsAsOf(vid, v.pub), t, params);
      const orac = channelCurve(priorsAsOf(vid, NOW, true), t, params);
      if (cens.typical && orac.typical) rows2b.push({ t, censored: cens.typical, oracle: orac.typical });
    }
  }
  const mk = (rs: Array<{ t: number }>, get: (r: any) => [number, number], label: string) => {
    const by = new Map<number, any[]>();
    for (const r of rs) { if (!by.has(r.t)) by.set(r.t, []); by.get(r.t)!.push(r); }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([t, g]) => ({ t, n: g.length, medALE: medALE(g.map(get)), bias: bias(g.map(get)) }));
  };
  const a = mk(rows2, (r) => [r.modelled, r.realOnly], 'modelled vs real-only');
  const b = mk(rows2b, (r) => [r.censored, r.oracle], 'censored vs oracle');
  json.parts.curve_accuracy = { modelledVsRealOnly: a, censoredVsCenteredOracle: b };
  tables.push(
    `## 2. Curve (C) accuracy\n\n### C built with interpolation vs C built from real samples only\n\n` +
    `Only ages where ≥3 priors have a real reading, so "real-only" is a measurement, not a model.\n\n` +
    `| t (days) | n | medALE | bias |\n|--:|--:|--:|--:|\n` +
    a.map((r) => `| ${r.t} | ${r.n} | ${fmt(r.medALE)} | ${fmt(r.bias)} |`).join('\n') +
    `\n\n### C censored at the target's publish clock vs the centered oracle (priors + up to 7 followers)\n\n` +
    `| t (days) | n | medALE | bias |\n|--:|--:|--:|--:|\n` +
    b.map((r) => `| ${r.t} | ${r.n} | ${fmt(r.medALE)} | ${fmt(r.bias)} |`).join('\n') + '\n'
  );
}

// ======================================================= 3. score accuracy (fully measured truth)
log('part 3: score accuracy');
{
  type SRow = { split: string; t: number; model: number; truth: number; share: number };
  const rows3: SRow[] = [];
  for (const vid of testIds) {
    const v = testById.get(vid)!;
    const splits = splitOf(v);
    if (!splits.length) continue;
    const obs = obsOf(vid);
    for (const t of SCORE_AGES) {
      const mine = readingAt(obs, t);
      if (!mine) continue;
      const T = mine.at;
      const all = priorsAsOf(vid, T);
      const real = all.filter((p) => contributionAt(p, t, params)?.kind === 'real');
      if (real.length < 3) continue;
      const cReal = channelCurve(real, t, params);
      const cAll = channelCurve(all, t, params);
      if (!cReal.typical || !cAll.typical) continue;
      for (const split of splits) rows3.push({ split, t, model: mine.views / cAll.typical, truth: mine.views / cReal.typical, share: cAll.measuredShare });
    }
  }
  const by = new Map<string, SRow[]>();
  for (const r of rows3) { const k = `${r.split}|${r.t}`; if (!by.has(k)) by.set(k, []); by.get(k)!.push(r); }
  const out3 = [...by.entries()].map(([k, g]) => {
    const [split, t] = k.split('|');
    const pairs = g.map((r) => [r.model, r.truth] as [number, number]);
    const p = prf(pairs, 2);
    return { split, t: Number(t), n: g.length, medALE: medALE(pairs), bias: bias(pairs), spearman: spearman(pairs), f1: p.f1, precision: p.precision, recall: p.recall, measuredShare: median(g.map((r) => r.share)) };
  }).sort((x, y) => x.split.localeCompare(y.split) || x.t - y.t);
  json.parts.score_accuracy = out3;
  tables.push(
    `## 3. Score accuracy — model ratio vs fully measured ratio\n\n` +
    `Rows where this video AND ≥3 priors have a real reading at t, so \`v(t)/C_real(t)\` is a measurement. ` +
    `The model column is production's answer: the same priors, interpolated as production would.\n\n` +
    `**Read medALE 0.000 correctly.** C is a weighted MEDIAN, so adding interpolated contributions ` +
    `to a set that already has three real ones usually does not move it at all -- the median stays ` +
    `on a real contribution. A zero cell means "interpolation did not distort this denominator", ` +
    `not "the score is exact". The cells that move are the ones where the measured share drops ` +
    `below 1, and those are the ones to read.\n\n` +
    `| split | t | n | medALE | bias | Spearman | F1@2× | prec | recall | med measured share |\n|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|\n` +
    out3.map((r) => `| ${r.split} | ${r.t} | ${r.n} | ${fmt(r.medALE)} | ${fmt(r.bias)} | ${fmt(r.spearman)} | ${fmt(r.f1)} | ${fmt(r.precision)} | ${fmt(r.recall)} | ${fmt(r.measuredShare, 2)} |`).join('\n') + '\n'
  );
}

// ============================================================== 4. projection accuracy
log('part 4: projection accuracy and band calibration');
{
  type PRow = { id: string; from: number; to: number; pred: number; truth: number; held: boolean };
  const rows4: PRow[] = [];
  for (const vid of testIds) {
    const obs = obsOf(vid);
    if (obs.length < 2) continue;
    const held = isHeld(vid);
    for (const from of [1, 3, 7, 14, 30]) {
      const start = readingAt(obs, from);
      if (!start) continue;
      const priors = priorsAsOf(vid, start.at);
      const upto = obs.filter((o) => o.at <= start.at).map((o) => ({ day: o.day, views: o.views }));
      const bucket = bucketFor(start.day, BUCKETS);
      const tol = bucketTolerance(bucket);
      const chLogs: number[] = [];
      for (const p of priors) {
        const nearB = [...p.samples].filter((s) => Math.abs(s.day - bucket) <= tol)
          .sort((a, b) => Math.abs(a.day - bucket) - Math.abs(b.day - bucket))[0];
        const at30 = [...p.samples].filter((s) => Math.abs(s.day - 30) <= 3)
          .sort((a, b) => Math.abs(a.day - 30) - Math.abs(b.day - 30))[0];
        if (nearB && at30) chLogs.push(Math.log(at30.views / nearB.views));
      }
      const ctx = { anchorAge: start.day, chMultLogs: chLogs, q: growthExponent(upto), bucket };
      for (const T of HORIZONS) {
        if (T <= from) continue;
        const truth = readingAt(obs, T);
        if (!truth || truth.at <= start.at) continue;
        rows4.push({ id: vid, from, to: T, pred: project(params, start.views, start.day, truth.day, ctx), truth: truth.views, held });
      }
    }
  }
  const by = new Map<string, PRow[]>();
  for (const r of rows4) { const k = `${r.from}|${r.to}`; if (!by.has(k)) by.set(k, []); by.get(k)!.push(r); }
  const out4 = [...by.entries()].map(([k, g]) => {
    const [from, to] = k.split('|').map(Number);
    const pairs = g.map((r) => [r.pred, r.truth] as [number, number]);
    return { from, to, n: g.length, medALE: medALE(pairs), bias: bias(pairs) };
  }).sort((a, b) => a.from - b.from || a.to - b.to);

  // Bands: fit the residual quantiles on TRAIN videos, measure coverage on the held-out ones.
  // ONE TABLE PER HORIZON -- a band keyed only on the reading age would pool a 7-day projection
  // with a 365-day one, which are not the same uncertainty. The fitted ages are exactly the
  // from-ages present: fitBands carries a thin bucket forward and then forces width to be
  // non-increasing, so a single unpopulated first bucket collapses the whole table to zero
  // width (which is what a naive BAND_AGES fit did here -- 0%/0% coverage, a harness artifact).
  const resid = (r: PRow) => Math.log(r.truth / r.pred);
  const FROM_AGES = [...new Set(rows4.map((r) => r.from))].sort((a, b) => a - b);
  const cal: any[] = [];
  let pi = 0, po = 0, pn = 0, pf = 0;
  for (const T of HORIZONS) {
    const g = rows4.filter((r) => r.to === T);
    const trainB = g.filter((r) => !r.held).map((r) => ({ age: r.from, resid: resid(r) }));
    const heldB = g.filter((r) => r.held);
    if (!trainB.length || !heldB.length) { cal.push({ horizon: T, fitRows: trainB.length, n: heldB.length, inner: null, outer: null }); continue; }
    const table = fitBands(trainB, FROM_AGES, 20);
    let inner = 0, outer = 0;
    for (const r of heldB) {
      const b = bandAt(table, r.from); const x = resid(r);
      if (x >= b.q25 && x <= b.q75) inner++;
      if (x >= b.q10 && x <= b.q90) outer++;
    }
    pi += inner; po += outer; pn += heldB.length; pf += trainB.length;
    cal.push({ horizon: T, fitRows: trainB.length, n: heldB.length, inner: inner / heldB.length, outer: outer / heldB.length });
  }
  const pooled = { horizon: 'pooled', fitRows: pf, n: pn, inner: pn ? pi / pn : null, outer: pn ? po / pn : null };
  json.parts.projection = { cells: out4, calibration: [...cal, pooled] };
  tables.push(
    `## 4. Projection accuracy — v̂(T) from a reading at t\n\n| from t | horizon T | n | medALE | bias |\n|--:|--:|--:|--:|--:|\n` +
    out4.map((r) => `| ${r.from} | ${r.to} | ${r.n} | ${fmt(r.medALE)} | ${fmt(r.bias)} |`).join('\n') +
    `\n\n### Band calibration — residual quantiles fitted on train videos, coverage measured on held-out\n\n` +
    `| horizon | fit rows | held-out n | inner (50% nominal) | outer (80% nominal) |\n|---|--:|--:|--:|--:|\n` +
    [...cal, pooled].map((c) => `| ${c.horizon} | ${c.fitRows} | ${c.n} | ${fmt(c.inner != null ? c.inner * 100 : null, 1)}% | ${fmt(c.outer != null ? c.outer * 100 : null, 1)}% |`).join('\n') + '\n'
  );
}

// =================================================================== 5. stability
log('part 5: stability');
{
  const pairsAges: Array<[number, number]> = [[0.5, 1], [1, 2], [2, 3], [3, 5], [5, 7], [7, 14], [14, 30], [30, 90]];
  const out5: any[] = [];
  for (const [a, b] of pairsAges) {
    const steps: number[] = [];
    for (const vid of testIds) {
      const obs = obsOf(vid);
      const ra = readingAt(obs, a), rb = readingAt(obs, b);
      if (!ra || !rb || ra.at >= rb.at) continue;
      const ca = channelCurve(priorsAsOf(vid, ra.at), ra.day, params);
      const cb = channelCurve(priorsAsOf(vid, rb.at), rb.day, params);
      if (!ca.typical || !cb.typical) continue;
      const sa = ra.views / ca.typical, sb = rb.views / cb.typical;
      // same truth call on both sides, as the v4 stability rows require
      if ((sa >= 2) !== (sb >= 2)) continue;
      steps.push(Math.abs(Math.log(sa / sb)));
    }
    out5.push({ pair: `${a}->${b}`, n: steps.length, medianStep: median(steps) });
  }
  json.parts.stability = out5;
  tables.push(
    `## 5. Stability — median |log(score_t / score_{t+1})| on adjacent readings\n\n` +
    `Pairs where the outlier call did not change between the two readings.\n\n| pair | n | median step |\n|---|--:|--:|\n` +
    out5.map((r) => `| ${r.pair} | ${r.n} | ${fmt(r.medianStep)} |`).join('\n') + '\n'
  );
}

// ============================================================ 6. backfill fidelity
log('part 6: backfill fidelity');
{
  type BRow = { target: number; pred: number; truth: number };
  const rows6: BRow[] = [];
  for (const id of allIds) {
    const m = metas.get(id); const obs = obsOf(id);
    if (!m || !(m.views > 0) || m.age < 60) continue;
    for (const t of [30, 90]) {
      const real = readingAt(obs, t, t <= 30 ? 3 : 9);
      if (!real) continue;
      rows6.push({ target: t, pred: m.views * Math.exp(growthLog(params, m.age, real.day)), truth: real.views });
    }
  }
  const by = new Map<number, BRow[]>();
  for (const r of rows6) { if (!by.has(r.target)) by.set(r.target, []); by.get(r.target)!.push(r); }
  const out6 = [...by.entries()].sort((a, b) => a[0] - b[0]).map(([t, g]) => {
    const pairs = g.map((r) => [r.pred, r.truth] as [number, number]);
    return { target: t, n: g.length, medALE: medALE(pairs), bias: bias(pairs) };
  });
  json.parts.backfill = out6;
  tables.push(
    `## 6. Backfill fidelity — today's lifetime count slid BACK down G to a real reading\n\n` +
    `| target age | n | medALE | bias |\n|--:|--:|--:|--:|\n` +
    out6.map((r) => `| ${r.target}d | ${r.n} | ${fmt(r.medALE)} | ${fmt(r.bias)} |`).join('\n') + '\n'
  );
}

// ============================================================ 7. regression to v4 at t=30
log('part 7: regression to v4 at t=30');
{
  const pairs: Array<[number, number]> = [];
  let vFive = 0, vFour = 0;
  for (const vid of testIds) {
    const v = testById.get(vid)!;
    const obs = obsOf(vid);
    const at30 = readingAt(obs, 30, 3);
    if (!at30) continue;
    const T = at30.at;
    const priors = priorsAsOf(vid, T);
    const c = channelCurve(priors, at30.day, params);
    if (c.typical) vFive++;
    // v4: actual30 / channelBaseline(prior day-30 estimates)
    const pv30: number[] = []; const ages: number[] = [];
    for (const p of priors) {
      const real30 = [...p.samples].filter((s) => Math.abs(s.day - 30) <= 3)
        .sort((a, b) => Math.abs(a.day - 30) - Math.abs(b.day - 30))[0];
      const latest = p.samples.length ? p.samples[p.samples.length - 1] : null;
      const est = corePriorV30(real30?.views ?? null, latest, params);
      if (est) { pv30.push(est.v30); ages.push(p.ageDays); }
    }
    const b4 = channelBaseline(pv30, ages).baseline;
    if (b4) vFour++;
    if (c.typical && b4) pairs.push([at30.views / c.typical, at30.views / b4]);
  }
  const out7 = {
    n: pairs.length, coverageV5: vFive, coverageV4: vFour,
    medALE: medALE(pairs), bias: bias(pairs), spearman: spearman(pairs),
    within10pct: pairs.length ? pairs.filter(([a, b]) => Math.abs(Math.log(a / b)) <= Math.log(1.1)).length / pairs.length : null,
    agreeOnOutlier: pairs.length ? pairs.filter(([a, b]) => (a >= 2) === (b >= 2)).length / pairs.length : null,
  };
  json.parts.v4_regression = out7;
  tables.push(
    `## 7. Regression to v4 at t=30\n\nBoth models define the score at day 30; this is how much they disagree there.\n\n` +
    `| metric | value |\n|---|--:|\n| rows with both scores | ${out7.n} |\n| videos with a v5 curve | ${out7.coverageV5} |\n| videos with a v4 baseline | ${out7.coverageV4} |\n` +
    `| medALE (v5 vs v4) | ${fmt(out7.medALE)} |\n| bias | ${fmt(out7.bias)} |\n| Spearman | ${fmt(out7.spearman)} |\n` +
    `| within ±10% | ${fmt(out7.within10pct != null ? out7.within10pct * 100 : null, 1)}% |\n| same outlier call | ${fmt(out7.agreeOnOutlier != null ? out7.agreeOnOutlier * 100 : null, 1)}% |\n`
  );
}

// ------------------------------------------------------------------------ output
const today = new Date().toISOString().slice(0, 10);
fs.mkdirSync(OUT_DIR, { recursive: true });
const stem = `${MODEL_VERSION}-${today}`;
const md = `# v5 verification — ${MODEL_VERSION}, ${today}\n\n` +
  `Population: ${pop.length} long-form public videos published in the last ${MONTHS} months with at least one reading; ` +
  `${testIds.length} sampled as targets, ${otherIds.length} distinct neighbours loaded. ` +
  `Params from \`score_params\` \`${PARAMS_VERSION}\` fitted ${stored[0].fitted_at}. ` +
  `Held-out split is \`bands.heldOut(id, ${HOLDOUT_SHARE})\`; the time split is videos published after ${new Date(TIME_CUT).toISOString().slice(0, 10)}.\n\n` +
  `Every n is stated per row. Truth in every part is a REAL reading, never another model's output.\n\n` +
  tables.join('\n');
fs.writeFileSync(path.join(OUT_DIR, `${stem}.verification.md`), md);
fs.writeFileSync(path.join(OUT_DIR, `${stem}.verification.json`), JSON.stringify(json, null, 2));
log(`wrote ${path.join(OUT_DIR, stem)}.verification.{md,json}`);
console.log(md);
await pool.end();
