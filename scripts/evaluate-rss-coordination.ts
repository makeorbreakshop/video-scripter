// Read-only paired evaluation of the v5.0 two-source reader against v5.1 RSS observations.
// Uses the same targets, priors, parameters and evaluation clock for both arms.
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import pg from 'pg';
import {
  MODEL_VERSION, PRIOR_WINDOW, PRIOR_STALE_DAYS, bucketFor, bucketTolerance, fittedBuckets,
  publishGapDays, priorWindow, type GlobalParams, type Snapshot,
} from '../lib/scoring/core';
import { scoreV5, type CurvePrior } from '../lib/scoring/curve';
import { longformSql } from '../lib/scoring/longform';
import { OBSERVATION_RECORDS_SQL, observationRecords } from '../lib/scoring/observations';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const LIMIT = Math.min(20, Math.max(1, Number(arg('--limit') || 20)));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
pool.on('connect', (c) => { c.query(`set default_transaction_read_only = on; set statement_timeout = 30000`).catch(() => {}); });
const client = await pool.connect();
await client.query('begin isolation level repeatable read read only');
const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows as any[];
const elapsed = async <T>(fn: () => Promise<T>): Promise<[T, number]> => { const s = performance.now(); return [await fn(), performance.now() - s]; };
const evaluationClock = new Date((await q('select transaction_timestamp() as at'))[0].at);

type Target = { id: string; channel_id: string };
type Prior = { id: string; pub: number; ageDays: number };
type Meta = { views: number; age: number };

function oldRecords(rows: any[]): Map<string, Snapshot[]> {
  const out = new Map<string, Snapshot[]>();
  for (const r of rows) {
    if (!(Number(r.views) > 0)) continue;
    if (!out.has(r.video_id)) out.set(r.video_id, []);
    out.get(r.video_id)!.push({ day: Number(r.day), views: Number(r.views) });
  }
  for (const points of out.values()) points.sort((a, b) => a.day - b.day);
  return out;
}

const targets = await q(
  `with candidate as (
     select video_id from track_schedule order by next_check desc limit 2000
   )
   select v.id, v.channel_id from candidate c join videos v on v.id = c.video_id
    where v.published_at > now() - interval '60 days' and ${longformSql('v')}
      and coalesce(v.privacy_status,'public') = 'public'
      and exists (select 1 from rss_samples r where r.video_id = v.id and r.views >= 0 and r.at <= now())
      and exists (select 1 from view_samples s where s.video_id = v.id)
    order by v.id limit $1`, [LIMIT]
) as Target[];

const priorRows = await q(
  `select r.id as video_id, p.id as prior_id, p.published_at,
          extract(epoch from (v.published_at - p.published_at))/86400.0 as gap_days
     from unnest($1::text[]) r(id) join videos v on v.id = r.id
     join lateral (
       select p.id, p.published_at from videos p
        where p.channel_id = v.channel_id and p.published_at < v.published_at
          and ${longformSql('p')} and coalesce(p.privacy_status,'public') = 'public'
          and coalesce(p.view_count,0) > 0
        order by p.published_at desc limit ${PRIOR_WINDOW}
     ) p on true`, [targets.map((t) => t.id)]
);
const priorsOf = new Map<string, Prior[]>();
for (const r of priorRows) {
  if (Number(r.gap_days) > PRIOR_STALE_DAYS) continue;
  if (!priorsOf.has(r.video_id)) priorsOf.set(r.video_id, []);
  priorsOf.get(r.video_id)!.push({ id: r.prior_id, pub: new Date(r.published_at).getTime(), ageDays: Number(r.gap_days) });
}
const allIds = [...new Set([...targets.map((t) => t.id), ...priorRows.map((r) => r.prior_id)])];

const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
async function chunked(sql: string, ids: string[]) {
  const rows: any[] = [];
  for (const group of chunks(ids, 100)) rows.push(...await q(sql, [group]));
  return rows;
}
const [oldRows, oldMs] = await elapsed(() => chunked(
    `select x.video_id, extract(epoch from (x.at-v.published_at))/86400.0 as day, x.views
       from (select video_id, snapshot_date::timestamptz + interval '12 hours' as at, view_count as views from view_snapshots where video_id=any($1)
             union all select video_id, sampled_at, view_count from view_samples where video_id=any($1)) x
       join videos v on v.id=x.video_id where x.views > 0 and x.at >= v.published_at and x.at <= now()
      order by x.video_id,x.at`, allIds));
const [newRows, newMs] = await elapsed(() => chunked(OBSERVATION_RECORDS_SQL, allIds));
const metaRows = await chunked(`select id, coalesce(view_count,0) views, extract(epoch from(now()-published_at))/86400.0 age from videos where id=any($1)`, allIds);
const truthRows = await chunked(`select distinct on(video_id) video_id,view_count from view_snapshots where video_id=any($1) and days_since_published between 27 and 33 and view_count>0 order by video_id,abs(days_since_published-30)`, allIds);
const paramsRows = await q(`select params from score_params where model_version=$1 order by fitted_at desc limit 1`, [MODEL_VERSION]);
if (!paramsRows.length) throw new Error(`missing ${MODEL_VERSION} parameters`);
const params = paramsRows[0].params as GlobalParams;
const oldRec = oldRecords(oldRows);
const newRec = observationRecords(newRows, evaluationClock.getTime());
const meta = new Map<string, Meta>(metaRows.map((r) => [r.id, { views: Number(r.views), age: Number(r.age) }]));
const truth = new Map<string, number>(truthRows.map((r) => [r.video_id, Number(r.view_count)]));

function result(t: Target, rec: Map<string, Snapshot[]>) {
  const snaps = rec.get(t.id); if (!snaps?.length) return null;
  const latest = snaps[snaps.length - 1];
  const priors = priorsOf.get(t.id) || [];
  const curvePriors: CurvePrior[] = priors.map((p) => ({
    id: p.id, ageDays: p.ageDays, samples: rec.get(p.id) || [],
    lifetime: meta.get(p.id)?.views ? { views: meta.get(p.id)!.views, ageDays: meta.get(p.id)!.age } : null,
  }));
  const bucket = bucketFor(latest.day, fittedBuckets(params));
  const tol = bucketTolerance(bucket);
  const estPriors = priors.slice(0, priorWindow(publishGapDays(priors.map((p) => p.pub))));
  const priorMultLogs: number[] = [];
  for (const p of estPriors) {
    const ps = rec.get(p.id), v30 = truth.get(p.id); if (!ps || !v30) continue;
    const near = ps.filter((s) => Math.abs(s.day - bucket) <= tol).sort((a, b) => Math.abs(a.day - bucket) - Math.abs(b.day - bucket))[0];
    if (near?.views) priorMultLogs.push(Math.log(v30 / near.views));
  }
  return scoreV5({ vt: latest.views, age: latest.day, snaps, priors: curvePriors, priorMultLogs, params });
}

const changes: Array<{ score: number; projection: number; ageHours: number }> = [];
for (const t of targets) {
  const before = result(t, oldRec), after = result(t, newRec); if (!before || !after) continue;
  const rel = (a: number | null, b: number | null) => a && b ? Math.abs(Math.log(b / a)) : a === b ? 0 : NaN;
  const score = rel(before.score, after.score), projection = rel(before.projection, after.projection);
  if (Number.isFinite(score) && Number.isFinite(projection)) changes.push({ score, projection, ageHours: (after.ageDays - before.ageDays) * 24 });
}
const percentile = (xs: number[], p: number) => { const a = [...xs].sort((x, y) => x-y); return a[Math.floor((a.length-1)*p)] || 0; };
const pct = (x: number) => `${(100 * (Math.exp(x) - 1)).toFixed(2)}%`;
console.log(JSON.stringify({
  targets: targets.length, compared: changes.length, distinctIdsRead: allIds.length,
  queryMs: { oldReader: Number(oldMs.toFixed(1)), rssReader: Number(newMs.toFixed(1)) },
  scoreAbsoluteChange: { median: pct(percentile(changes.map((x) => x.score), .5)), p90: pct(percentile(changes.map((x) => x.score), .9)), max: pct(percentile(changes.map((x) => x.score), 1)) },
  projectionAbsoluteChange: { median: pct(percentile(changes.map((x) => x.projection), .5)), p90: pct(percentile(changes.map((x) => x.projection), .9)), max: pct(percentile(changes.map((x) => x.projection), 1)) },
  newestObservationAgeAdvanceHours: { median: percentile(changes.map((x) => x.ageHours), .5).toFixed(2), p90: percentile(changes.map((x) => x.ageHours), .9).toFixed(2) },
  paramsVersion: MODEL_VERSION, readOnly: true,
  evaluationClock: evaluationClock.toISOString(), isolation: 'repeatable read',
}, null, 2));
await client.query('rollback');
client.release();
await pool.end();
