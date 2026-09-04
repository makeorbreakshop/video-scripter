// Walk-forward backtest of the CHANNEL BASELINE rule (read-only).
//
// Question: when a video is t days old, can we build a baseline for its channel, and how close
// is that baseline to the one we would compute later once every prior has a real day-30 count?
//
// Two rules are compared at the same frozen clock T = published_at + t days. Only prior
// snapshots dated on or before T are visible (strict censoring; the older validate-scoring.ts
// lets prior day-30 truth leak from the future).
//   CURRENT  last 10 priors; a prior counts only with a real day-30 snapshot (day 27..33) or,
//            when >= 45 days old at T, its latest count divided down the long tail. (mirrors
//            scripts/score-videos.ts priorsFor + lib/scoring/core estimateV30)
//   PROPOSED the shipped rule in lib/scoring/core (priorV30 / priorWindow): up to 15 priors
//            (10 on sparse channels), none older than PRIOR_STALE_DAYS; real day-30 first, else
//            long-tail normalisation past day 30, else the latest visible count projected
//            FORWARD to day 30 through the fitted multiplier table (prior >= MIN_PROJECT_AGE).
// Oracle = median real day-30 of the proposed rule's prior set, uncensored (needs >= 3).
//
// Reported per t and per channel cadence (median gap between the priors' publish dates):
//   coverage        share of holdout videos that get a baseline at t
//   baseline medALE median |log(baseline_t / oracle)| where both exist
//   score medALE    median |log(score_t / score_final)|, score_final = v30 / oracle
//   outlier P/R/F1  predicted score_t >= 2 vs truth v30/oracle >= 2
// est30_t is the same under both rules (scoreVideo with censored priorMultLogs), so any
// difference in score error comes from the baseline alone.
//
// Usage: npx tsx scripts/backtest-baseline.ts [--from 2025-07-01] [--to 2025-08-31] [--limit 8000] [--min-prior-age 2]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import {
  scoreVideo, bucketFor, median, estimateV30, MODEL_VERSION,
  priorV30 as corePriorV30, publishGapDays, priorWindow, PRIOR_WINDOW, PRIOR_STALE_DAYS, MIN_PROJECT_AGE,
  type GlobalParams,
} from '../lib/scoring/core';
import { longformSql } from '../lib/scoring/longform';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const FROM = arg('--from') ?? '2025-07-01';
const TO = arg('--to') ?? '2025-08-31';
const LIMIT = Number(arg('--limit') ?? 8000);
const MIN_PRIOR_AGE = Number(arg('--min-prior-age') ?? MIN_PROJECT_AGE);
const T_LIST = [1, 3, 7];
const N_CURRENT = 10, N_PROPOSED = PRIOR_WINDOW;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 600000').catch(() => {}); });
const q = async (sql: string, params?: any[]): Promise<any[]> => (await pool.query(sql, params)).rows as any[];
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

const params: GlobalParams = (await q(`select params from score_params where model_version=$1 order by fitted_at desc limit 1`, [MODEL_VERSION]))[0].params;

type Snap = { day: number; views: number; at: number }; // at = epoch ms of the snapshot

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

// priors: last 15 prior public long-form videos per holdout video, with publish times
const priorRows: { video_id: string; prior_id: string; ppub: number }[] = await q(
  `select r.id as video_id, p.id as prior_id, extract(epoch from p.published_at)*1000 as ppub
     from unnest($1::text[]) as r(id) join videos v on v.id=r.id
     join lateral (select p.id, p.published_at from videos p
                    where p.channel_id=v.channel_id and p.published_at < v.published_at
                      and ${longformSql('p')}
                      and coalesce(p.privacy_status,'public')='public' and coalesce(p.view_count,0)>0
                    order by p.published_at desc limit ${N_PROPOSED}) p on true`, [ids]);
const priorsOf = new Map<string, { id: string; pub: number }[]>();
for (const r of priorRows) { if (!priorsOf.has(r.video_id)) priorsOf.set(r.video_id, []); priorsOf.get(r.video_id)!.push({ id: r.prior_id, pub: Number(r.ppub) }); }
const priorIds = [...new Set(priorRows.map((r) => r.prior_id))];
log(`priors: ${priorIds.length} distinct`);
const pRecs = await snapsFor(priorIds);

function cadence(priors: { pub: number }[]): 'daily' | 'weekly' | 'sparse' | 'none' {
  if (priors.length < 3) return 'none';
  const p = [...priors].sort((a, b) => a.pub - b.pub);
  const gaps: number[] = [];
  for (let i = 1; i < p.length; i++) gaps.push((p[i].pub - p[i - 1].pub) / 86_400_000);
  const g = median(gaps) ?? 99;
  return g <= 2.5 ? 'daily' : g <= 9 ? 'weekly' : 'sparse';
}

type Rule = 'current' | 'proposed';
function priorV30(rule: Rule, pid: string, ppub: number, T: number): { v30: number; kind: 'real' | 'lifetime' | 'projected' } | null {
  const s = (pRecs.get(pid) ?? []).filter((x) => x.at <= T);
  const real = day30Of(s, T);
  const latest = s.length ? s[s.length - 1] : null;
  if (rule === 'current') {
    if (real) return { v30: real, kind: 'real' };
    if (!latest) return null;
    const age = (T - ppub) / 86_400_000;
    const e = estimateV30(null, latest.views, age, params.longtail);
    return e ? { v30: e.v30, kind: 'lifetime' } : null;
  }
  return corePriorV30(real, latest, params, MIN_PRIOR_AGE);
}

type Acc = { n: number; cov: number; bErr: number[]; sErr: number[]; tp: number; fp: number; fn: number; kinds: Record<string, number> };
const acc = (): Acc => ({ n: 0, cov: 0, bErr: [], sErr: [], tp: 0, fp: 0, fn: 0, kinds: { real: 0, lifetime: 0, projected: 0 } });
const results = new Map<string, Acc>(); // key `${t}|${rule}|${cadence}`
const get = (k: string) => { if (!results.has(k)) results.set(k, acc()); return results.get(k)!; };

for (const t of T_LIST) {
  const tol = t <= 3 ? 1 : 2;
  for (const v of vids) {
    const snaps = recs.get(v.id); const v30 = day30Of(snaps);
    if (!snaps || !v30) continue;
    const near = snaps.filter((s) => Math.abs(s.day - t) <= tol).sort((a, b) => Math.abs(a.day - t) - Math.abs(b.day - t))[0];
    if (!near) continue;
    const T = near.at;
    const priors = priorsOf.get(v.id) ?? [];
    const cad = cadence(priors);
    const oracleVals = priors.map((p) => day30Of(pRecs.get(p.id))).filter((x): x is number => !!x);
    const oracle = oracleVals.length >= 3 ? median(oracleVals)! : null;

    // est30 at T, identical for both rules
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

    for (const rule of ['current', 'proposed'] as Rule[]) {
      const fresh = priors.filter((p) => (v.pub - p.pub) / 86_400_000 <= PRIOR_STALE_DAYS);
      const pool = rule === 'current'
        ? priors.slice(0, N_CURRENT)
        : fresh.slice(0, priorWindow(publishGapDays(fresh.map((p) => p.pub))));
      const ests = pool.map((p) => priorV30(rule, p.id, p.pub, T)).filter((x): x is NonNullable<typeof x> => !!x);
      const baseline = ests.length >= 3 ? median(ests.map((e) => e.v30))! : null;
      for (const key of [`${t}|${rule}|all`, `${t}|${rule}|${cad}`]) {
        const a = get(key);
        a.n++;
        if (baseline) {
          a.cov++;
          for (const e of ests) a.kinds[e.kind]++;
          if (oracle) {
            a.bErr.push(Math.abs(Math.log(baseline / oracle)));
            const scoreT = est30 / baseline, scoreF = v30 / oracle;
            a.sErr.push(Math.abs(Math.log(scoreT / scoreF)));
            const yt = scoreF >= 2, yp = scoreT >= 2;
            if (yt && yp) a.tp++; else if (yp) a.fp++; else if (yt) a.fn++;
          }
        }
      }
    }
  }
}

const f = (x: number | null | undefined, d = 3) => (x == null ? '   -  ' : x.toFixed(d).padStart(6));
console.log('\nt  rule      cadence  n     coverage  base_medALE  score_medALE  outlierP  outlierR  F1     priors(real/lifetime/projected)');
for (const t of T_LIST) for (const cad of ['all', 'daily', 'weekly', 'sparse', 'none']) for (const rule of ['current', 'proposed']) {
  const a = results.get(`${t}|${rule}|${cad}`); if (!a || !a.n) continue;
  const p = a.tp / Math.max(a.tp + a.fp, 1), r = a.tp / Math.max(a.tp + a.fn, 1), f1 = (2 * p * r) / Math.max(p + r, 1e-9);
  const k = a.kinds; const tot = Math.max(k.real + k.lifetime + k.projected, 1);
  console.log(
    `${String(t).padEnd(2)} ${rule.padEnd(9)} ${cad.padEnd(8)} ${String(a.n).padEnd(5)} ${(a.cov / a.n).toFixed(3).padStart(8)}  ${f(median(a.bErr))}       ${f(median(a.sErr))}        ${f(p, 2)}    ${f(r, 2)}    ${f(f1, 2)}  ${(k.real / tot * 100).toFixed(0)}%/${(k.lifetime / tot * 100).toFixed(0)}%/${(k.projected / tot * 100).toFixed(0)}%`
  );
}
await pool.end();
