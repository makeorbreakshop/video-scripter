// Walk-forward backtest of CHANNEL BASELINE rules against a CENTERED truth (read-only).
//
// Hypothesis (2026-09-04): the shipped baseline -- median day-30 of the last <=15 priors -- is a
// trailing statistic and therefore LAGS the channel's level. On a growing channel it sits below
// where the channel is now, so ordinary videos score high; on a declining channel the reverse.
// A time-weighted rule (exponential kernel over publish age) or a local trend read at the
// publish date should cut that lag. The cell that should move: signed bias by channel trend
// (growing / declining), then score medALE and outlier F1 on those slices. If the lag is not
// there, bias on `growing` for the current rule will sit near 0 and this file is a null result.
//
// Truth is what scripts/backtest-baseline.ts cannot give: there the oracle is the median real
// day-30 of the SAME trailing prior set, so a trailing rule is judged against itself and any
// rule that reads the channel differently is penalised by construction. Here:
//   oracle_ctr  median real day-30 of the channel's neighbours around the target video --
//               up to K_SIDE priors and K_SIDE followers, the target excluded, needs >= 3.
//               "What a normal video published then did." Uncensored (future is fine for truth).
//   trend       log( median real day-30 of the followers / same of the priors ), split at +-0.3.
//
// Rules, all strictly censored at the frozen clock T = the target's age-t snapshot:
//   current     the shipped v3 rule (core.priorV30 + priorWindow, plain median)
//   tw<h>       exponential time-weighted median of log v30 over the last <=N_TW fresh priors,
//               weight = 2^(-age/h) where age = target publish - prior publish, in days
//   trend<h>    weighted local-linear fit of log v30 on publish date (same kernel), read at the
//               target's publish date; falls back to tw<h> when fewer than 5 priors
// Prior day-30 estimates come from core.priorV30 for every rule, so the only thing that differs
// between rules is how the priors are combined.
//
// Usage: npx tsx scripts/backtest-baseline-trend.ts [--from 2025-07-01] [--to 2025-08-31] [--limit 4000]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { makeTimedPool } from '../lib/admin/db';
import {
  scoreVideo, bucketFor, median, MODEL_VERSION,
  priorV30 as corePriorV30, publishGapDays, priorWindow, PRIOR_STALE_DAYS, MIN_PROJECT_AGE,
  type GlobalParams,
} from '../lib/scoring/core';
import { longformSql } from '../lib/scoring/longform';
import { activeParamsQuery } from '../lib/scoring/params-status';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const FROM = arg('--from') ?? '2025-07-01';
const TO = arg('--to') ?? '2025-08-31';
const LIMIT = Number(arg('--limit') ?? 4000);
const T_LIST = [1, 3, 7];
const N_TW = Number(arg('--n-tw') ?? 30);          // priors visible to the kernel rules
const N_CURRENT = 10;     // priors used for est30's channel multiplier (as in production)
const K_SIDE = 7;         // neighbours per side for the centered oracle
const HALF_LIVES = (arg('--half-lives') ?? '45,90,180').split(',').map(Number);
const TREND_CUT = 0.3;
const DAY = 86_400_000;

// Heavy analysis queries run through makeTimedPool: each pool.query becomes
// `begin; set local statement_timeout = N; ...; commit`. The old
// `pool.on('connect', c => c.query('set statement_timeout = ...'))` below it did nothing on the
// :6543 pooler -- the SET lands after the queries it was meant to protect -- so these scripts
// ran at the 300 s role default and, when the client gave up first, left the query running
// server-side. That is what orphaned backends during the 2026-09-08 v5.3 attempt.
const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 3, timeoutMs: 600_000 });
const q = async (sql: string, params?: any[]): Promise<any[]> => (await pool.query(sql, params)).rows as any[];
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

const PARAMS_VERSION = arg('--params-version') ?? MODEL_VERSION;
/** One specific score_params row (a candidate under gate), instead of the newest active one. */
const PARAMS_ID = arg('--params-id') ? Number(arg('--params-id')) : null;
const paramRows = PARAMS_ID
  ? await q(`select params from score_params where id = $1`, [PARAMS_ID])
  : await q(activeParamsQuery('params'), [PARAMS_VERSION]);
if (!paramRows.length) { console.error(`no score_params for ${PARAMS_ID ?? PARAMS_VERSION}`); process.exit(1); }
const params: GlobalParams = paramRows[0].params;

// ============================================================ v5.3 estimate coverage (t=0.5)
//
//   npx tsx scripts/backtest-baseline-trend.ts --estimate-coverage [--params-version v3.0]
//
// THE QUESTION v5.3 has to answer. channelCurve now returns an ESTIMATE where it used to return
// null: the channel's level read at the nearest ladder age it does have one at, slid to the
// target along the global growth curve. Is that slide any good?
//
// It can be asked without waiting for outcomes, because a growing number of channels DO have
// launch samples (5-minute sampling since 2026-08-01) and therefore a MEASURED C(0.5). On those
// channels, hide every prior reading under a day -- exactly the starvation the rest of the
// corpus is in -- and let v5.3 estimate C(0.5) from day 1 and up. Then compare:
//
//   err = log( C_estimated(0.5) / C_measured(0.5) )
//
// medALE, signed bias, and the share inside +-0.3 log (the prespecified band: a denominator
// within ~35% either way, which at a 2x outlier threshold cannot flip a call on its own).
// This measures the SLIDE and nothing else: same priors, same kernel, same weights, one input
// removed. It is not an outcome backtest and does not claim to be.
if (process.argv.includes('--estimate-coverage')) {
  const { channelCurve, measuredCurveAt, SUBDAY_SLIDE_MAX_AGE } = await import('../lib/scoring/curve');
  const { loadCurvePriors } = await import('../lib/scoring/prior-load');
  const T_EST = Number(arg('--t') ?? 0.5);
  const BAND = Number(arg('--band') ?? 0.3);
  const LIM = Number(arg('--limit') ?? 4000);

  // Targets on channels whose PRIORS have sub-day readings: that is where a measured C(0.5)
  // can exist at all. view_samples is the launch ladder; view_snapshots rarely lands under a day.
  log(`estimate coverage at t=${T_EST}: targets on channels whose priors have sub-day samples`);
  // Driven from view_samples (the launch ladder, running since 2026-08-01) rather than from a
  // scan of every video: the sub-day readings are the scarce side, so they lead the plan.
  const tgt: { id: string }[] = await q(
    `with recent as (
       select id, channel_id, published_at from videos
        where published_at >= '2026-08-01' and published_at < now() - interval '1 day'),
     subday as (
       select distinct p.channel_id, p.id
         from recent p join view_samples s on s.video_id = p.id
        where s.sampled_at < p.published_at + interval '1 day'
          and s.view_count > 0),
     ch as (select channel_id from subday group by channel_id having count(*) >= 3)
     select v.id from videos v join ch on ch.channel_id = v.channel_id
      where ${longformSql('v')} and coalesce(v.privacy_status,'public')='public'
      order by v.published_at desc limit $1`, [LIM]);
  log(`candidate targets: ${tgt.length}`);

  // TWO masks, because "starved" is not one condition.
  //   >=1d   every reading under a day removed. A prior with a day-1..3 reading still contributes
  //          at 0.5 by INTERPOLATION (contributionAt step 2 allows a slide from under
  //          SUBDAY_SLIDE_MAX_AGE), so this mostly does NOT reach the v5.3 estimate branch. It
  //          measures the older sub-day path, and is reported to show how often that suffices.
  //   >3d    every reading under SUBDAY_SLIDE_MAX_AGE removed. This is the real corpus: a channel
  //          whose priors were first seen at day 17 or day 45. Nothing can contribute at 0.5, so
  //          v5.2 returned null and v5.3 estimates. THIS is the cell that validates the slide.
  const MASKS: [string, number][] = [['>=1d', 1], ['>3d', SUBDAY_SLIDE_MAX_AGE + 1e-9]];
  const res = new Map<string, { errs: number[]; est: number; stillMeasured: number; anchors: Map<number, number> }>();
  for (const [name] of MASKS) res.set(name, { errs: [], est: 0, stillMeasured: 0, anchors: new Map() });
  let measurable = 0, targets = 0;
  for (let i = 0; i < tgt.length; i += 200) {
    const batch = tgt.slice(i, i + 200).map((r) => r.id);
    const byVideo = await loadCurvePriors(q, batch);
    for (const id of batch) {
      const priors = byVideo.get(id) ?? [];
      if (!priors.length) continue;
      targets++;
      const truth = measuredCurveAt(priors, T_EST, params);
      if (truth.typical == null) continue;      // no measured C(0.5) here: nothing to check against
      measurable++;
      for (const [name, cut] of MASKS) {
        const a = res.get(name)!;
        const starved = priors.map((p) => ({ ...p, samples: p.samples.filter((sm) => sm.day >= cut) }));
        const est = channelCurve(starved, T_EST, params);
        if (est.typical == null) continue;
        if (est.kind !== 'estimated') { a.stillMeasured++; continue; }
        a.est++;
        a.anchors.set(est.anchorAge!, (a.anchors.get(est.anchorAge!) ?? 0) + 1);
        a.errs.push(Math.log(est.typical / truth.typical));
      }
    }
  }
  console.log(`\n--- v5.3 estimate validation, t=${T_EST} (params ${PARAMS_VERSION}) ---`);
  console.log(`targets with priors:                 ${targets}`);
  console.log(`of those, a MEASURED C(${T_EST}) exists:  ${measurable}`);
  for (const [name] of MASKS) {
    const a = res.get(name)!;
    const errs = a.errs, abs = errs.map(Math.abs);
    const within = abs.filter((x) => x <= BAND).length;
    console.log(`\n  mask keep samples ${name}`);
    console.log(`    still measurable at t (no estimate needed): ${a.stillMeasured}`);
    console.log(`    reached the ESTIMATE branch:                ${a.est}`);
    if (!errs.length) { console.log('    (no paired rows)'); continue; }
    const srt = [...abs].sort((x, y) => x - y);
    console.log(`    medALE |log(est/measured)|:                 ${median(abs)!.toFixed(4)}`);
    console.log(`    bias    log(est/measured):                  ${median(errs)!.toFixed(4)}`);
    console.log(`    within +-${BAND} log:                          ${within}/${errs.length} (${(100 * within / errs.length).toFixed(1)}%)`);
    console.log(`    p90 ALE:                                    ${srt[Math.floor(0.9 * (srt.length - 1))].toFixed(4)}`);
    console.log(`    anchors: ${[...a.anchors.entries()].sort((x, y) => y[1] - x[1]).map(([ag, n]) => `${ag}d=${n}`).join('  ')}`);
  }
  await pool.end();
  process.exit(0);
}

type Snap = { day: number; views: number; at: number };

log(`holdout: videos published ${FROM}..${TO} with an early (<=3d) snapshot and day-30 truth (limit ${LIMIT})`);
const vids: { id: string; channel_id: string; pub: number }[] = (await q(
  `select v.id, v.channel_id, extract(epoch from v.published_at)*1000 as pub from videos v
    where v.published_at between $1 and $2 and ${longformSql('v')}
      and coalesce(v.privacy_status,'public')='public'
      and exists (select 1 from view_snapshots s where s.video_id=v.id and s.days_since_published between 27 and 33 and s.view_count>0)
      and exists (select 1 from view_snapshots s where s.video_id=v.id and s.days_since_published <= 3 and s.view_count>0)
    order by random() limit $3`, [FROM, TO, LIMIT]
)).map((r: any) => ({ id: r.id, channel_id: r.channel_id, pub: Number(r.pub) }));
log(`holdout videos: ${vids.length}`);
const ids = vids.map((v) => v.id);

async function snapsFor(vidIds: string[]): Promise<Map<string, Snap[]>> {
  const out = new Map<string, Snap[]>();
  for (let i = 0; i < vidIds.length; i += 5000) {
    const rows = await q(
      `select video_id, days_since_published as day, view_count as views,
              extract(epoch from (snapshot_date::timestamptz + interval '12 hours'))*1000 as at
         from view_snapshots where video_id = any($1) and view_count > 0 order by video_id, snapshot_date`,
      [vidIds.slice(i, i + 5000)]
    );
    for (const r of rows) { if (!out.has(r.video_id)) out.set(r.video_id, []); out.get(r.video_id)!.push({ day: Number(r.day), views: Number(r.views), at: Number(r.at) }); }
  }
  return out;
}
const day30Of = (s: Snap[] | undefined, before = Infinity): number | null => {
  const c = (s ?? []).filter((x) => x.day >= 27 && x.day <= 33 && x.at <= before).sort((a, b) => Math.abs(a.day - 30) - Math.abs(b.day - 30));
  return c.length ? c[0].views : null;
};

const recs = await snapsFor(ids);

// neighbours: last N_TW priors and next K_SIDE followers per holdout video
const nbrRows: { video_id: string; nid: string; npub: number; side: 'prior' | 'next' }[] = await q(
  `select r.id as video_id, p.id as nid, extract(epoch from p.published_at)*1000 as npub, 'prior' as side
     from unnest($1::text[]) as r(id) join videos v on v.id=r.id
     join lateral (select p.id, p.published_at from videos p
                    where p.channel_id=v.channel_id and p.published_at < v.published_at
                      and ${longformSql('p')}
                      and coalesce(p.privacy_status,'public')='public' and coalesce(p.view_count,0)>0
                    order by p.published_at desc limit ${N_TW}) p on true
   union all
   select r.id, p.id, extract(epoch from p.published_at)*1000, 'next'
     from unnest($1::text[]) as r(id) join videos v on v.id=r.id
     join lateral (select p.id, p.published_at from videos p
                    where p.channel_id=v.channel_id and p.published_at > v.published_at
                      and ${longformSql('p')}
                      and coalesce(p.privacy_status,'public')='public' and coalesce(p.view_count,0)>0
                    order by p.published_at asc limit ${K_SIDE}) p on true`, [ids]);
const priorsOf = new Map<string, { id: string; pub: number }[]>();
const nextOf = new Map<string, { id: string; pub: number }[]>();
for (const r of nbrRows) {
  const m = r.side === 'prior' ? priorsOf : nextOf;
  if (!m.has(r.video_id)) m.set(r.video_id, []);
  m.get(r.video_id)!.push({ id: r.nid, pub: Number(r.npub) });
}
for (const v of priorsOf.values()) v.sort((a, b) => b.pub - a.pub);   // newest first
for (const v of nextOf.values()) v.sort((a, b) => a.pub - b.pub);     // soonest first
const nbrIds = [...new Set(nbrRows.map((r) => r.nid))];
log(`neighbours: ${nbrIds.length} distinct`);
const pRecs = await snapsFor(nbrIds);

// ---- rules ----
function weightedMedian(xs: number[], ws: number[]): number | null {
  const idx = xs.map((_, i) => i).filter((i) => Number.isFinite(xs[i]) && ws[i] > 0).sort((a, b) => xs[a] - xs[b]);
  if (!idx.length) return null;
  const tot = idx.reduce((s, i) => s + ws[i], 0);
  let acc = 0;
  for (const i of idx) { acc += ws[i]; if (acc >= tot / 2) return xs[i]; }
  return xs[idx[idx.length - 1]];
}
function effectiveN(ws: number[]): number {
  const s = ws.reduce((a, b) => a + b, 0), s2 = ws.reduce((a, b) => a + b * b, 0);
  return s2 > 0 ? (s * s) / s2 : 0;
}
/** Weighted least squares of y on x, evaluated at x0. Null when the design is degenerate. */
function wlsAt(x: number[], y: number[], w: number[], x0: number): number | null {
  const sw = w.reduce((a, b) => a + b, 0);
  if (!(sw > 0)) return null;
  const mx = x.reduce((a, xi, i) => a + w[i] * xi, 0) / sw, my = y.reduce((a, yi, i) => a + w[i] * yi, 0) / sw;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < x.length; i++) { sxx += w[i] * (x[i] - mx) ** 2; sxy += w[i] * (x[i] - mx) * (y[i] - my); }
  if (sxx < 1e-9) return my;
  const b = sxy / sxx;
  // clamp the slope: no more than a doubling/halving per 90 days, so a thin window cannot explode
  const cap = Math.LN2 / 90;
  const bc = Math.max(-cap, Math.min(cap, b));
  return my + bc * (x0 - mx);
}

type Rule = string;
const LASTN = (arg('--last-n') ?? '5,7').split(',').map(Number);
const RULES: Rule[] = ['current', ...LASTN.map((n) => `last${n}`), ...HALF_LIVES.map((h) => `tw${h}`), ...(arg('--no-trend') ? [] : HALF_LIVES.map((h) => `trend${h}`))];

type Est = { v30: number; kind: string; ageDays: number };
function baselineFor(rule: Rule, ests: Est[], gapDays: number | null): { baseline: number | null; neff: number } {
  if (rule === 'current' || rule.startsWith('last')) {
    const pool = ests.slice(0, rule === 'current' ? priorWindow(gapDays) : Number(rule.slice(4)));
    return { baseline: pool.length >= 3 ? median(pool.map((e) => e.v30)) : null, neff: pool.length };
  }
  const h = Number(rule.replace(/^\D+/, ''));
  const ws = ests.map((e) => Math.pow(2, -e.ageDays / h));
  const ys = ests.map((e) => Math.log(e.v30));
  const neff = effectiveN(ws);
  if (ests.length < 3 || neff < 2) return { baseline: null, neff };
  if (rule.startsWith('tw') || ests.length < 5) {
    const m = weightedMedian(ys, ws);
    return { baseline: m == null ? null : Math.exp(m), neff };
  }
  const xs = ests.map((e) => -e.ageDays); // days relative to the target publish (<= 0)
  const yhat = wlsAt(xs, ys, ws, 0);
  return { baseline: yhat == null ? null : Math.exp(yhat), neff };
}

type Acc = { n: number; cov: number; bias: number[]; bErr: number[]; sErr: number[]; tp: number; fp: number; fn: number; neff: number[] };
const acc = (): Acc => ({ n: 0, cov: 0, bias: [], bErr: [], sErr: [], tp: 0, fp: 0, fn: 0, neff: [] });
const results = new Map<string, Acc>(); // `${t}|${rule}|${slice}`
const get = (k: string) => { if (!results.has(k)) results.set(k, acc()); return results.get(k)!; };
const sliceCount = new Map<string, number>();

for (const t of T_LIST) {
  const tol = t <= 3 ? 1 : 2;
  for (const v of vids) {
    const snaps = recs.get(v.id); const v30 = day30Of(snaps);
    if (!snaps || !v30) continue;
    const near = snaps.filter((s) => Math.abs(s.day - t) <= tol).sort((a, b) => Math.abs(a.day - t) - Math.abs(b.day - t))[0];
    if (!near) continue;
    const T = near.at;
    const priors = priorsOf.get(v.id) ?? [];
    const nexts = nextOf.get(v.id) ?? [];

    // centered truth and trend, uncensored
    const pReal = priors.slice(0, K_SIDE).map((p) => day30Of(pRecs.get(p.id))).filter((x): x is number => !!x);
    const nReal = nexts.map((p) => day30Of(pRecs.get(p.id))).filter((x): x is number => !!x);
    const ctr = [...pReal, ...nReal];
    if (ctr.length < 3) continue;
    const oracle = median(ctr)!;
    let trend = 'unknown';
    if (pReal.length >= 3 && nReal.length >= 3) {
      const d = Math.log(median(nReal)! / median(pReal)!);
      trend = d > TREND_CUT ? 'growing' : d < -TREND_CUT ? 'declining' : 'flat';
    }
    const gapAll = publishGapDays(priors.map((p) => p.pub));
    const cad = gapAll == null ? 'none' : gapAll <= 2.5 ? 'daily' : gapAll <= 9 ? 'weekly' : 'sparse';
    if (t === T_LIST[0]) sliceCount.set(trend, (sliceCount.get(trend) ?? 0) + 1);

    // est30 at T, identical for every rule
    const upto = snaps.filter((s) => s.at <= T);
    const bucket = bucketFor(near.day); const btol = bucket <= 3 ? 1 : bucket <= 7 ? 2 : 3;
    const priorMultLogs: number[] = [];
    for (const p of priors.slice(0, N_CURRENT)) {
      const ps = (pRecs.get(p.id) ?? []).filter((x) => x.at <= T);
      const p30 = day30Of(ps, T);
      const nb = ps.filter((s) => Math.abs(s.day - bucket) <= btol).sort((a, b) => Math.abs(a.day - bucket) - Math.abs(b.day - bucket))[0];
      if (nb && p30) priorMultLogs.push(Math.log(p30 / nb.views));
    }
    const est30 = scoreVideo({ vt: near.views, day: near.day, snaps: upto, priorMultLogs, priorV30: [], priorAgeDays: [], priorSameAge: [], params }).est30;

    // censored prior estimates, newest first, fresh only
    const fresh = priors.filter((p) => (v.pub - p.pub) / DAY <= PRIOR_STALE_DAYS);
    const gap = publishGapDays(fresh.map((p) => p.pub));
    const ests: Est[] = [];
    for (const p of fresh) {
      const s = (pRecs.get(p.id) ?? []).filter((x) => x.at <= T);
      const e = corePriorV30(day30Of(s, T), s.length ? s[s.length - 1] : null, params, MIN_PROJECT_AGE);
      if (e) ests.push({ v30: e.v30, kind: e.kind, ageDays: (v.pub - p.pub) / DAY });
    }

    for (const rule of RULES) {
      const { baseline, neff } = baselineFor(rule, ests, gap);
      for (const key of [`${t}|${rule}|all`, `${t}|${rule}|${trend}`, `${t}|${rule}|${cad}`]) {
        const a = get(key);
        a.n++;
        if (baseline) {
          a.cov++;
          a.neff.push(neff);
          const lb = Math.log(baseline / oracle);
          a.bias.push(lb); a.bErr.push(Math.abs(lb));
          const scoreT = est30 / baseline, scoreF = v30 / oracle;
          a.sErr.push(Math.abs(Math.log(scoreT / scoreF)));
          const yt = scoreF >= 2, yp = scoreT >= 2;
          if (yt && yp) a.tp++; else if (yp) a.fp++; else if (yt) a.fn++;
        }
      }
    }
  }
}

const f = (x: number | null | undefined, d = 3) => (x == null ? '   -  ' : (x >= 0 ? ' ' : '') + x.toFixed(d).padStart(5));
console.log(`\nslices (t=${T_LIST[0]}): ${[...sliceCount.entries()].map(([k, n]) => `${k}=${n}`).join('  ')}`);
console.log('\nt  rule      slice      n     cov    bias    base_medALE  score_medALE  P     R     F1    neff');
for (const t of T_LIST) for (const sl of ['all', 'growing', 'flat', 'declining', 'daily', 'weekly', 'sparse']) for (const rule of RULES) {
  const a = results.get(`${t}|${rule}|${sl}`); if (!a || !a.n) continue;
  const p = a.tp / Math.max(a.tp + a.fp, 1), r = a.tp / Math.max(a.tp + a.fn, 1), f1 = (2 * p * r) / Math.max(p + r, 1e-9);
  console.log(
    `${String(t).padEnd(2)} ${rule.padEnd(9)} ${sl.padEnd(10)} ${String(a.n).padEnd(5)} ${(a.cov / a.n).toFixed(2)}  ${f(median(a.bias))}   ${f(median(a.bErr))}       ${f(median(a.sErr))}      ${f(p, 2)} ${f(r, 2)} ${f(f1, 2)}  ${f(median(a.neff), 1)}`
  );
}
await pool.end();
