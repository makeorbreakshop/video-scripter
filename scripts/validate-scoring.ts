// Validates the production scorer port against 2025 day-30 truth (read-only).
// Holdout: videos published in the LAST month of the dense window (Sept 2025 uploads whose day-30 truth landed
// by early Oct), predicted from their day-1/3/7 snapshots using the CURRENT stored params and the SAME
// lib/scoring/core functions the hourly job uses. Compare medALE to the harness (v3 time split: .30/.19/.10).
// Usage: npx tsx scripts/validate-scoring.ts
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { scoreVideo, bucketFor, GlobalParams, MODEL_VERSION, Snapshot, median } from '../lib/scoring/core';
import { longformSql } from '../lib/scoring/longform';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 300000').catch(() => {}); });
const q = async (sql: string, params?: any[]): Promise<any[]> => (await pool.query(sql, params)).rows as any[];

const params: GlobalParams = (await q(`select params from score_params where model_version=$1 order by fitted_at desc limit 1`, [MODEL_VERSION]))[0].params;

// holdout videos: published 2025-07-20..2025-08-15 (inside the fit window: a port check, not an out-of-sample test — the harness did that), non-short, with day-30 truth
const vids: { id: string; channel_id: string; published_at: string }[] = await q(
  `select v.id, v.channel_id, v.published_at from videos v
    where v.published_at between '2025-07-20' and '2025-08-15' and ${longformSql('v')}
      and exists (select 1 from view_snapshots s where s.video_id=v.id and s.days_since_published between 27 and 33 and s.view_count>0)
    limit 6000`
);
console.log(`holdout videos: ${vids.length}`);
const ids = vids.map((v) => v.id);
const snapRows = await q(
  `select video_id, days_since_published as day, view_count as views from view_snapshots where video_id = any($1) and view_count > 0 order by video_id, snapshot_date`, [ids]);
const recs = new Map<string, Snapshot[]>();
for (const r of snapRows) { if (!recs.has(r.video_id)) recs.set(r.video_id, []); recs.get(r.video_id)!.push({ day: Number(r.day), views: Number(r.views) }); }
const truthRows = await q(`select distinct on (video_id) video_id, view_count from view_snapshots where video_id = any($1) and days_since_published between 27 and 33 and view_count>0 order by video_id, abs(days_since_published-30)`, [ids]);
const truth = new Map<string, number>(truthRows.map((r: any) => [r.video_id, Number(r.view_count)]));

// priors (walk-forward by publish date only; day-30 truth of priors may postdate the test video's day t — mild optimism, same as harness S*)
const priorRows: { video_id: string; prior_id: string }[] = await q(
  `select r.id as video_id, p.id as prior_id from unnest($1::text[]) as r(id) join videos v on v.id=r.id
   join lateral (select p.id from videos p where p.channel_id=v.channel_id and p.published_at < v.published_at and ${longformSql('p')} order by p.published_at desc limit 10) p on true`, [ids]);
const priorsOf = new Map<string, string[]>();
for (const r of priorRows) { if (!priorsOf.has(r.video_id)) priorsOf.set(r.video_id, []); priorsOf.get(r.video_id)!.push(r.prior_id); }
const priorIds = [...new Set(priorRows.map((r) => r.prior_id))];
const pSnapRows = await q(`select video_id, days_since_published as day, view_count as views from view_snapshots where video_id = any($1) and view_count > 0 order by video_id, snapshot_date`, [priorIds]);
const pRecs = new Map<string, Snapshot[]>();
for (const r of pSnapRows) { if (!pRecs.has(r.video_id)) pRecs.set(r.video_id, []); pRecs.get(r.video_id)!.push({ day: Number(r.day), views: Number(r.views) }); }
const pTruthRows = await q(`select distinct on (video_id) video_id, view_count from view_snapshots where video_id = any($1) and days_since_published between 27 and 33 and view_count>0 order by video_id, abs(days_since_published-30)`, [priorIds]);
const pTruth = new Map<string, number>(pTruthRows.map((r: any) => [r.video_id, Number(r.view_count)]));

for (const t of [1, 3, 7, 14]) {
  const tol = t <= 3 ? 1 : t <= 7 ? 2 : 3;
  const errs: number[] = []; const persist: number[] = []; let tp = 0, fp = 0, fn = 0;
  for (const v of vids) {
    const snaps = recs.get(v.id); const v30 = truth.get(v.id);
    if (!snaps || !v30) continue;
    const near = snaps.filter((s) => Math.abs(s.day - t) <= tol).sort((a, b) => Math.abs(a.day - t) - Math.abs(b.day - t))[0];
    if (!near) continue;
    const upto = snaps.filter((s) => s.day <= near.day);
    const bucket = bucketFor(near.day); const btol = bucket <= 3 ? 1 : bucket <= 7 ? 2 : 3;
    const priorMultLogs: number[] = []; const priorV30: number[] = []; const priorSameAge: number[] = [];
    for (const pid of priorsOf.get(v.id) ?? []) {
      const ps = pRecs.get(pid); const p30 = pTruth.get(pid);
      if (p30) priorV30.push(p30);
      if (ps) {
        const sa = ps.filter((s) => Math.abs(s.day - near.day) <= Math.max(1, near.day / 4)).sort((a, b) => Math.abs(a.day - near.day) - Math.abs(b.day - near.day))[0];
        if (sa) priorSameAge.push(sa.views);
        const nb = ps.filter((s) => Math.abs(s.day - bucket) <= btol).sort((a, b) => Math.abs(a.day - bucket) - Math.abs(b.day - bucket))[0];
        if (nb && p30) priorMultLogs.push(Math.log(p30 / nb.views));
      }
    }
    const out = scoreVideo({ vt: near.views, day: near.day, snaps: upto, priorMultLogs, priorV30, priorSameAge, params });
    errs.push(Math.abs(Math.log(out.est30 / v30)));
    persist.push(Math.abs(Math.log(near.views / v30)));
    if (out.baseline) {
      const yt = v30 / out.baseline >= 2, yp = out.score! >= 2;
      if (yt && yp) tp++; else if (yp) fp++; else if (yt) fn++;
    }
  }
  const p = tp / Math.max(tp + fp, 1), r = tp / Math.max(tp + fn, 1);
  console.log(`t=${t}: n=${errs.length} medALE=${median(errs)?.toFixed(3)} (persistence ${median(persist)?.toFixed(3)}) outlier P=${p.toFixed(2)} R=${r.toFixed(2)} F1=${(2 * p * r / Math.max(p + r, 1e-9)).toFixed(2)}`);
}
await pool.end();
