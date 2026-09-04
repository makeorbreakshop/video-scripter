// PAIRED leave-one-out check of G below one day: the same hidden readings, reconstructed under
// two score_params rows. The full harness resamples its 5,000 targets each run, so a before/after
// across two runs is confounded by the sample; this is not.
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { contributionAt } from '../lib/scoring/curve';
import { longformSql } from '../lib/scoring/longform';
import { medALE, bias } from '../lib/scoring/v5-metrics';
import type { GlobalParams, Snapshot } from '../lib/scoring/core';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 600000').catch(() => {}); });
const q = async (s: string, p?: any[]) => (await pool.query(s, p)).rows as any[];
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

const ids: string[] = (await q(
  `select v.id from videos v
    where v.published_at >= '2026-08-01' and ${longformSql('v')}
      and coalesce(v.privacy_status,'public') = 'public'
      and exists (select 1 from view_samples s where s.video_id = v.id
                   and s.sampled_at < v.published_at + interval '12 hours')
    order by v.published_at desc limit 12000`
)).map((r) => r.id);
log(`${ids.length} videos with sub-day readings`);

const rec = new Map<string, Snapshot[]>();
for (let i = 0; i < ids.length; i += 2000) {
  const g = ids.slice(i, i + 2000);
  for (const r of await q(
    `select x.video_id, extract(epoch from (x.at - v.published_at))/86400.0 as day, x.views
       from (select video_id, snapshot_date::timestamptz + interval '12 hours' as at, view_count as views from view_snapshots where video_id = any($1)
             union all
             select video_id, sampled_at, view_count from view_samples where video_id = any($1)) x
       join videos v on v.id = x.video_id
      where x.views > 0 and x.at >= v.published_at order by x.video_id, x.at`, [g])) {
    if (!rec.has(r.video_id)) rec.set(r.video_id, []);
    rec.get(r.video_id)!.push({ day: Number(r.day), views: Number(r.views) });
  }
  log(`records ${rec.size}`);
}

const rows = await q(`select id, fitted_at, params from score_params where model_version='v5.0' order by fitted_at desc limit 5`);
const NEW = rows[0], OLD = rows.find((r: any) => r.id !== NEW.id && !(r.params as any).launch?.since);
log(`new params id=${NEW.id} ${NEW.fitted_at}   old params id=${OLD.id} ${OLD.fitted_at}`);

const BUCKETS: [string, number, number][] = [
  ['<1h', 0, 1 / 24], ['1h-4h', 1 / 24, 4 / 24], ['4h-12h', 4 / 24, 0.5],
  ['12h-1d', 0.5, 1], ['1d-2d', 1, 2], ['2d-3d', 2, 3],
];
type Row = [number, number];
const acc = new Map<string, { a: Row[]; b: Row[] }>();
for (const [k] of BUCKETS) acc.set(k, { a: [], b: [] });

for (const [, obs] of rec) {
  if (obs.length < 4) continue;
  for (let i = 0; i < obs.length; i++) {
    const hidden = obs[i];
    if (!(hidden.day > 0 && hidden.day < 3 && hidden.views > 0)) continue;
    const rest = obs.filter((_, k) => k !== i);
    const ca = contributionAt({ ageDays: 0, samples: rest }, hidden.day, OLD.params as GlobalParams);
    const cb = contributionAt({ ageDays: 0, samples: rest }, hidden.day, NEW.params as GlobalParams);
    // paired: only rows BOTH tables reconstruct by interpolation
    if (!ca || !cb || ca.kind !== 'interpolated' || cb.kind !== 'interpolated') continue;
    const b = BUCKETS.find(([, lo, hi]) => hidden.day >= lo && hidden.day < hi);
    if (!b) continue;
    acc.get(b[0])!.a.push([ca.views, hidden.views]);
    acc.get(b[0])!.b.push([cb.views, hidden.views]);
  }
}

console.log('\n| bucket | n | medALE old | medALE new | Δ | bias old | bias new |');
console.log('|---|--:|--:|--:|--:|--:|--:|');
for (const [k] of BUCKETS) {
  const { a, b } = acc.get(k)!;
  if (!a.length) { console.log(`| ${k} | 0 | — | — | — | — | — |`); continue; }
  const mA = medALE(a)!, mB = medALE(b)!;
  console.log(`| ${k} | ${a.length} | ${mA.toFixed(3)} | ${mB.toFixed(3)} | ${(mB - mA >= 0 ? '+' : '')}${(mB - mA).toFixed(3)} | ${bias(a)!.toFixed(3)} | ${bias(b)!.toFixed(3)} |`);
}
await pool.end();
