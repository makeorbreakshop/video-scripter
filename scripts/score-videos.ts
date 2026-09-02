// Model v3 scorer. Direct Postgres only.
//   npx tsx scripts/score-videos.ts --fit        refit global params from the last 12 months (nightly)
//   npx tsx scripts/score-videos.ts [--all]      score videos published <=60d whose latest snapshot/sample
//                                                is newer than their stored score (hourly); --all rescoress all
// Reads: videos, view_snapshots, view_samples, score_params. Writes: video_scores, score_params (--fit).
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { chunk } from '../lib/nightly/tracking-core';
import { scoreVideo, fitParams, bucketFor, growthExponent, GlobalParams, MODEL_VERSION, Snapshot, FitRow, DAY_BUCKETS } from '../lib/scoring/core';

const FIT = process.argv.includes('--fit');
const ALL = process.argv.includes('--all');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 300000').catch(() => {}); });
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const q = async (sql: string, params?: any[]): Promise<any[]> => (await pool.query(sql, params)).rows as any[];

// Snapshot record for a set of videos: daily snapshots + high-res samples, as true-age days.
async function records(ids: string[]): Promise<Map<string, Snapshot[]>> {
  const out = new Map<string, Snapshot[]>();
  const rows = await q(
    `select x.video_id, extract(epoch from (x.at - v.published_at))/86400.0 as day, x.views
       from (select video_id, snapshot_date::timestamptz + interval '12 hours' as at, view_count as views from view_snapshots where video_id = any($1)
             union all
             select video_id, sampled_at, view_count from view_samples where video_id = any($1)) x
       join videos v on v.id = x.video_id
      where x.views > 0 and x.at >= v.published_at
      order by x.video_id, x.at`,
    [ids]
  );
  for (const r of rows) {
    if (!out.has(r.video_id)) out.set(r.video_id, []);
    out.get(r.video_id)!.push({ day: Number(r.day), views: Number(r.views) });
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

async function fit() {
  log('fit: collecting videos published in the last 18 months with a day-30 truth');
  const vids = await q(
    `select distinct s.video_id from view_snapshots s join videos v on v.id = s.video_id
      where s.days_since_published between 27 and 33 and s.view_count > 0
        and v.published_at > now() - interval '18 months' and coalesce(v.is_short,false)=false and coalesce(v.duration,'')<>'P0D'
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
  await pool.query(`insert into score_params (model_version, n_videos, params) values ($1, $2, $3)`, [MODEL_VERSION, ids.length, JSON.stringify(params)]);
  log(`fit: stored params from ${fitRows.length} (video, bucket) rows; mult=${JSON.stringify(Object.fromEntries(Object.entries(params.mult).map(([k, v]) => [k, Number(Math.exp(v).toFixed(2))])))}`);
}

async function score() {
  const p = await q(`select params from score_params where model_version = $1 order by fitted_at desc limit 1`, [MODEL_VERSION]);
  if (!p.length) { console.error('no score_params; run --fit first'); process.exit(1); }
  const params: GlobalParams = p[0].params;

  const targets: { id: string; channel_id: string; published_at: string }[] = await q(
    ALL
      ? `select v.id, v.channel_id, v.published_at from videos v
          where v.published_at > now() - interval '60 days' and coalesce(v.is_short,false)=false and coalesce(v.duration,'')<>'P0D'`
      : `select v.id, v.channel_id, v.published_at from videos v
          left join video_scores sc on sc.video_id = v.id
          where v.published_at > now() - interval '60 days' and coalesce(v.is_short,false)=false and coalesce(v.duration,'')<>'P0D'
            and (sc.video_id is null
                 or exists (select 1 from view_samples s where s.video_id = v.id and s.sampled_at > sc.scored_at)
                 or exists (select 1 from view_snapshots s where s.video_id = v.id and s.created_at > sc.scored_at))`
  );
  log(`score: ${targets.length} videos to score`);
  let written = 0;
  for (const group of chunk(targets, 500)) {
    const ids = group.map((r) => r.id);
    // priors: last <=10 prior non-short videos per channel, with their day-30 truth and full records
    const priorRows: { video_id: string; prior_id: string }[] = await q(
      `select r.id as video_id, p.id as prior_id
         from unnest($1::text[]) as r(id) join videos v on v.id = r.id
         join lateral (select p.id from videos p where p.channel_id = v.channel_id and p.published_at < v.published_at
                        and coalesce(p.is_short,false)=false order by p.published_at desc limit 10) p on true`,
      [ids]
    );
    const priorsOf = new Map<string, string[]>();
    for (const r of priorRows) { if (!priorsOf.has(r.video_id)) priorsOf.set(r.video_id, []); priorsOf.get(r.video_id)!.push(r.prior_id); }
    const priorIds: string[] = [...new Set(priorRows.map((r) => r.prior_id))];
    const [rec, priorRec, truth] = await Promise.all([records(ids), records(priorIds), day30(priorIds)]);

    const values: any[] = []; const tuples: string[] = [];
    for (const t of group) {
      const snaps = rec.get(t.id);
      if (!snaps?.length) continue;
      const latest = snaps[snaps.length - 1];
      const bucket = bucketFor(latest.day);
      const tol = bucket <= 3 ? 1 : bucket <= 7 ? 2 : 3;
      const priorMultLogs: number[] = []; const priorV30: number[] = []; const priorSameAge: number[] = [];
      for (const pid of priorsOf.get(t.id) ?? []) {
        const ps = priorRec.get(pid); const v30 = truth.get(pid);
        if (v30) priorV30.push(v30);
        if (ps) {
          const near = ps.filter((s) => Math.abs(s.day - latest.day) <= Math.max(1, latest.day / 4)).sort((a, b) => Math.abs(a.day - latest.day) - Math.abs(b.day - latest.day))[0];
          if (near) priorSameAge.push(near.views);
          const nearB = ps.filter((s) => Math.abs(s.day - bucket) <= tol).sort((a, b) => Math.abs(a.day - bucket) - Math.abs(b.day - bucket))[0];
          if (nearB && v30) priorMultLogs.push(Math.log(v30 / nearB.views));
        }
      }
      const out = scoreVideo({ vt: latest.views, day: latest.day, snaps, priorMultLogs, priorV30, priorSameAge, params });
      const i = values.length;
      values.push(t.id, t.channel_id, MODEL_VERSION, latest.day, latest.views, out.q, out.est30, out.baseline, out.nBaseline, out.score, out.sameAgeRatio, out.nSameAge, out.confidence);
      tuples.push(`($${i + 1},$${i + 2},$${i + 3},now(),$${i + 4},$${i + 5},$${i + 6},$${i + 7},$${i + 8},$${i + 9},$${i + 10},$${i + 11},$${i + 12},$${i + 13})`);
    }
    if (!tuples.length) continue;
    await pool.query(
      `insert into video_scores (video_id, channel_id, model_version, scored_at, snapshot_day, views, q, est30, baseline, n_baseline, score, same_age_ratio, n_same_age, confidence)
       values ${tuples.join(',')}
       on conflict (video_id) do update set channel_id=excluded.channel_id, model_version=excluded.model_version, scored_at=excluded.scored_at,
         snapshot_day=excluded.snapshot_day, views=excluded.views, q=excluded.q, est30=excluded.est30, baseline=excluded.baseline,
         n_baseline=excluded.n_baseline, score=excluded.score, same_age_ratio=excluded.same_age_ratio, n_same_age=excluded.n_same_age, confidence=excluded.confidence`,
      values
    );
    written += tuples.length;
    if (written % 5000 < 500) log(`score: ${written} written`);
  }
  log(`score: done, ${written} videos scored`);
}

if (FIT) await fit(); else await score();
await pool.end();
