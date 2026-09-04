// Diagnostic for the v5 channel curve on one video.
//   npx tsx scripts/diagnose-curve.ts <videoId> [--age <days>]
//
// Dumps, for every prior of the target video: its lifetime count and age, its samples, the route
// contributionAt() takes (real / interpolated / lifetime), the multipliers G applies to slide the
// reading to the target age, and the resulting contribution. Then prints channelCurve's C(t) and
// C(30) against lib/admin/video-curve.ts's expectedAtAge(C(30), mult, t) -- the number the video
// page draws. The two must agree; when they do not, this is the file that says why.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import {
  bucketFor, fittedBuckets, growthExponent, MODEL_VERSION, type GlobalParams, type Snapshot,
} from '../lib/scoring/core';
import { logToRef, growthLog } from '../lib/scoring/growth';
import { channelCurve, contributionAt, sameAgeTolerance, scoreV5, type CurvePrior } from '../lib/scoring/curve';
import { expectedAtAge } from '../lib/admin/video-curve';
import { longformSql } from '../lib/scoring/longform';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const q = async (sql: string, p?: any[]): Promise<any[]> => (await pool.query(sql, p)).rows as any[];
const VIDEO = process.argv[2];
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const AGE_OVERRIDE = Number(argOf('--age') ?? NaN);
const f = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));

async function records(ids: string[]): Promise<Map<string, Snapshot[]>> {
  const out = new Map<string, Snapshot[]>();
  const rows = await q(
    `select x.video_id, extract(epoch from (x.at - v.published_at))/86400.0 as day, x.views
       from (select video_id, snapshot_date::timestamptz + interval '12 hours' as at, view_count as views from view_snapshots where video_id = any($1)
             union all
             select video_id, sampled_at, view_count from view_samples where video_id = any($1)) x
       join videos v on v.id = x.video_id
      where x.views > 0 and x.at >= v.published_at
      order by x.video_id, x.at`, [ids]);
  for (const r of rows) {
    if (!out.has(r.video_id)) out.set(r.video_id, []);
    out.get(r.video_id)!.push({ day: Number(r.day), views: Number(r.views) });
  }
  return out;
}

async function main() {
  if (!VIDEO) { console.error('usage: diagnose-curve.ts <videoId> [--age <days>]'); process.exit(1); }
  const [params] = await q(
    `select params from score_params where model_version = $1 order by fitted_at desc limit 1`, [MODEL_VERSION]);
  if (!params) { console.error(`no score_params for ${MODEL_VERSION}`); process.exit(1); }
  const P: GlobalParams = params.params;

  const [tgt] = await q(
    `select v.id, v.title, v.channel_id, coalesce(c.channel_name, c.channel_id) as channel, v.published_at,
            extract(epoch from (now() - v.published_at))/86400.0 as age
       from videos v left join channels c on c.channel_id = v.channel_id where v.id = $1`, [VIDEO]);
  if (!tgt) { console.error(`no video ${VIDEO}`); process.exit(1); }

  const priors = await q(
    `select p.id, p.title, coalesce(p.view_count,0) as views,
            extract(epoch from (now() - p.published_at))/86400.0 as lifetime_age,
            extract(epoch from ($2::timestamptz - p.published_at))/86400.0 as gap_days
       from videos p
      where p.channel_id = $1 and p.published_at < $2::timestamptz
        and coalesce(p.privacy_status,'public') = 'public' and coalesce(p.view_count,0) > 0
        and ${longformSql('p')}
      order by p.published_at desc limit 15`, [tgt.channel_id, tgt.published_at]);

  const rec = await records([VIDEO, ...priors.map((p: any) => p.id)]);
  const snaps = rec.get(VIDEO) ?? [];
  const latest = snaps[snaps.length - 1];
  const age = Number.isFinite(AGE_OVERRIDE) ? AGE_OVERRIDE : latest ? latest.day : Number(tgt.age);

  console.log(`\n${tgt.id}  ${tgt.title}`);
  console.log(`channel: ${tgt.channel} (${tgt.channel_id})   published ${tgt.published_at}`);
  console.log(`target age ${f(age, 4)}d (${f(age * 24, 2)}h)   views ${latest?.views ?? '—'}   snaps ${snaps.length}`);
  console.log(`\nparams ${MODEL_VERSION} fittedAt=${P.fittedAt}`);
  console.log(`  hour ladder: ${Object.keys(P.mult).filter((k) => Number(k) < 1).map((k) => `${(Number(k) * 24).toFixed(0)}h=${f(P.mult[Number(k)], 3)}`).join(' ') || '(none fitted)'}`);
  console.log(`  day buckets: ${Object.keys(P.mult).filter((k) => Number(k) >= 1).map((k) => `${k}d=${f(P.mult[Number(k)], 3)}`).join(' ')}`);
  console.log(`  longtail: ${(P.longtail?.ages ?? []).map((a, i) => `${a}d=${f(P.longtail!.mult[i], 3)}`).join(' ')}`);
  console.log(`  logToRef(${f(age, 3)}d) = ${f(logToRef(P, age), 4)}   logToRef(1d)=${f(logToRef(P, 1), 4)}   logToRef(30d)=0`);
  console.log(`  tolerance at target age: ±${f(sameAgeTolerance(age), 4)}d`);

  const curvePriors: CurvePrior[] = priors.map((p: any) => ({
    id: p.id, ageDays: Number(p.gap_days), samples: rec.get(p.id) ?? [],
    lifetime: Number(p.views) > 0 ? { views: Number(p.views), ageDays: Number(p.lifetime_age) } : null,
  }));

  console.log(`\n--- per prior, sliding to target age ${f(age, 4)}d -------------------------------------`);
  console.log('id           gapD  nSamp  sampleAges            lifetime@age        route         fromAge   G-mult    contrib');
  for (const p of curvePriors) {
    const c = contributionAt(p, age, P);
    const ss = [...p.samples].sort((a, b) => a.day - b.day);
    const ages = ss.length ? `${f(ss[0].day, 2)}..${f(ss[ss.length - 1].day, 2)}` : '(none)';
    const gm = c && c.kind !== 'real' ? Math.exp(growthLog(P, c.fromAge, age, null)) : 1;
    console.log(
      `${p.id}  ${f(p.ageDays, 1).padStart(5)}  ${String(ss.length).padStart(5)}  ${ages.padEnd(20)}  ` +
      `${(p.lifetime ? `${p.lifetime.views}@${f(p.lifetime.ageDays, 0)}d` : '—').padEnd(18)}  ` +
      `${(c?.kind ?? 'none').padEnd(12)}  ${f(c?.fromAge, 2).padStart(7)}  ${f(gm, 4).padStart(8)}  ${f(c?.views, 0).padStart(9)}`);
    // The two-hop decomposition for a lifetime prior: lifetime -> day30 -> target age.
    if (c?.kind === 'lifetime' && p.lifetime) {
      const toTail = Math.exp(-logToRef(P, p.lifetime.ageDays)); // lifetime / v30 (long-tail mult)
      const v30 = p.lifetime.views / toTail;
      const ladder = Math.exp(-logToRef(P, age));                // v(age) / v30
      console.log(`               longtail(${f(p.lifetime.ageDays, 0)}d)=${f(toTail, 3)}x -> v30≈${f(v30, 0)}  ×ladder(${f(age, 3)}d)=${f(ladder, 4)} -> ${f(v30 * ladder, 0)}`);
    }
  }

  const cT = channelCurve(curvePriors, age, P);
  const c30 = channelCurve(curvePriors, 30, P);
  console.log(`\n--- channelCurve ------------------------------------------------------------------`);
  console.log(`C(${f(age, 3)}d) = ${f(cT.typical, 0)}   n=${cT.n} neff=${f(cT.neff, 2)} measuredShare=${f(cT.measuredShare, 2)}`);
  console.log(`C(30)      = ${f(c30.typical, 0)}   n=${c30.n} neff=${f(c30.neff, 2)} measuredShare=${f(c30.measuredShare, 2)}`);
  console.log(`  kinds at t: ${JSON.stringify(cT.contributions.reduce((a: any, c) => ((a[c.kind] = (a[c.kind] ?? 0) + 1), a), {}))}`);

  const pageTypical = expectedAtAge(c30.typical, P.mult as any, age, P.longtail as any);
  console.log(`\n--- lib/admin/video-curve.ts (what the video page draws) ---------------------------`);
  console.log(`expectedAtAge(C(30)=${f(c30.typical, 0)}, ${f(age, 3)}d) = ${f(pageTypical, 0)}`);
  if (cT.typical && pageTypical) {
    console.log(`RATIO channelCurve / page = ${f(cT.typical / pageTypical, 3)}x`);
  }

  if (latest) {
    const o = scoreV5({ vt: latest.views, age, snaps, priors: curvePriors, priorMultLogs: [], params: P });
    console.log(`\n--- scoreV5 -----------------------------------------------------------------------`);
    console.log(`score=${f(o.score, 3)} typicalAtAge=${f(o.typicalAtAge, 0)} typicalAt30=${f(o.typicalAt30, 0)} ` +
      `n=${o.nTypical} measured=${f(o.typicalMeasuredShare, 2)} conf=${o.confidence} q=${f(o.q, 3)}`);
    if (pageTypical) console.log(`page-path score would be ${f(latest.views / pageTypical, 3)}`);
    console.log(`bucketFor(${f(age, 3)}) = ${bucketFor(age, fittedBuckets(P))}   Q=${f(growthExponent([...snaps]), 3)}`);
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
