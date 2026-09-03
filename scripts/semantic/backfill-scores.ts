// Semantic v2 Phase 0 scoring repair. Direct Postgres only.
//
// Dry-run:
//   npx tsx scripts/semantic/backfill-scores.ts
//
// Write:
//   npx tsx scripts/semantic/backfill-scores.ts --write
//
// Useful flags:
//   --days 365 --min-age-days 0 --limit 5000 --batch-size 500 --sleep 400
//   --model-version v3.1-semantic-backfill-2026-09 --params-version v3.0
//   --force --checkpoint tmp/semantic-score-backfill-state.json
//
// Reads: videos, view_snapshots, view_samples, score_params. Writes: video_scores only
// when --write is present. Does not import or use the Supabase REST client.

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { chunk } from '../../lib/nightly/tracking-core';
import {
  bucketFor,
  estimateV30,
  GlobalParams,
  growthExponent,
  median,
  scoreVideo,
  Snapshot,
} from '../../lib/scoring/core';
import {
  coverageBandSql,
  eligibleWhere,
  parseBackfillArgs,
  shouldUseFinalPath,
  targetStatusSql,
} from '../../lib/scoring/backfill';

const opts = parseBackfillArgs(process.argv.slice(2));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
pool.on('connect', (c: pg.PoolClient) => {
  c.query('set statement_timeout = 45000').catch(() => {});
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);
const q = async (sql: string, params?: unknown[]): Promise<any[]> => (await pool.query(sql, params)).rows as any[];

interface Target {
  id: string;
  channel_id: string;
  published_at: string;
  age_days: number;
}

interface Cursor {
  published_at: string;
  id: string;
}

interface Checkpoint {
  modelVersion: string;
  days: number;
  minAgeDays: number;
  cursor: Cursor | null;
  written: number;
  skipped: number;
}

interface Meta {
  views: number;
  age: number;
}

function loadCheckpoint(): Checkpoint | null {
  if (!opts.write || opts.force || !fs.existsSync(opts.checkpoint)) return null;
  const data = JSON.parse(fs.readFileSync(opts.checkpoint, 'utf8')) as Checkpoint;
  if (data.modelVersion !== opts.modelVersion || data.days !== opts.days || data.minAgeDays !== opts.minAgeDays) {
    throw new Error(`checkpoint ${opts.checkpoint} does not match this backfill run`);
  }
  return data;
}

function saveCheckpoint(state: Checkpoint) {
  if (!opts.write) return;
  fs.mkdirSync(path.dirname(opts.checkpoint), { recursive: true });
  fs.writeFileSync(opts.checkpoint, `${JSON.stringify(state, null, 2)}\n`);
}

async function params(): Promise<GlobalParams> {
  const rows = await q(
    `select params from score_params where model_version = $1 order by fitted_at desc limit 1`,
    [opts.paramsVersion]
  );
  if (!rows.length) throw new Error(`no score_params found for ${opts.paramsVersion}; run the scorer fit first`);
  const out = rows[0].params as GlobalParams;
  if (!out.longtail) throw new Error(`score_params ${opts.paramsVersion} has no longtail table`);
  return out;
}

async function records(ids: string[]): Promise<Map<string, Snapshot[]>> {
  if (!ids.length) return new Map();
  const out = new Map<string, Snapshot[]>();
  const rows = await q(
    `select x.video_id, extract(epoch from (x.at - v.published_at))/86400.0 as day, x.views
       from (select video_id, snapshot_date::timestamptz + interval '12 hours' as at, view_count as views
               from view_snapshots where video_id = any($1)
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

async function day30(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await q(
    `select distinct on (video_id) video_id, view_count
       from view_snapshots
      where video_id = any($1) and days_since_published between 27 and 33 and view_count > 0
      order by video_id, abs(days_since_published - 30)`,
    [ids]
  );
  return new Map<string, number>(rows.map((r: any) => [r.video_id as string, Number(r.view_count)]));
}

async function meta(ids: string[]): Promise<Map<string, Meta>> {
  if (!ids.length) return new Map();
  const rows = await q(
    `select id, coalesce(view_count,0) as views, extract(epoch from (now() - published_at))/86400.0 as age
       from videos where id = any($1)`,
    [ids]
  );
  return new Map<string, Meta>(rows.map((r: any) => [r.id as string, { views: Number(r.views), age: Number(r.age) }]));
}

function v30Of(
  id: string,
  truth: Map<string, number>,
  metas: Map<string, Meta>,
  longtail: GlobalParams['longtail']
) {
  const m = metas.get(id);
  return estimateV30(truth.get(id) ?? null, m?.views ?? null, m?.age ?? 0, longtail);
}

async function priorsFor(ids: string[]): Promise<Map<string, string[]>> {
  if (!ids.length) return new Map();
  const rows: { video_id: string; prior_id: string }[] = await q(
    `select r.id as video_id, p.id as prior_id
       from unnest($1::text[]) as r(id)
       join videos v on v.id = r.id
       join lateral (
         select p.id
           from videos p
          where p.channel_id = v.channel_id
            and p.published_at < v.published_at
            and coalesce(p.is_short,false)=false
            and coalesce(p.duration,'')<>'P0D'
            and coalesce(p.privacy_status,'public') = 'public'
            and coalesce(p.view_count,0) > 0
          order by p.published_at desc
          limit 10
       ) p on true`,
    [ids]
  );
  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (!out.has(r.video_id)) out.set(r.video_id, []);
    out.get(r.video_id)!.push(r.prior_id);
  }
  return out;
}

async function coverageReport() {
  const rows = await q(
    `select ${coverageBandSql('v')} as age_band,
            ${targetStatusSql('s')} as status,
            count(*)::int as videos,
            count(*) filter (where s.score is not null)::int as numeric_scores,
            count(*) filter (where s.score >= 2 and s.confidence = any($4))::int as trusted_outliers,
            count(distinct v.channel_id)::int as channels
       from videos v
       left join video_scores s on s.video_id = v.id
      where ${eligibleWhere('v')}
      group by 1, 2
      order by 1, 2`,
    [opts.days, opts.minAgeDays, opts.modelVersion, ['likely', 'confirmed']]
  );
  log(`dry-run coverage for target model ${opts.modelVersion}`);
  for (const r of rows) {
    log(`${r.age_band} ${r.status}: videos=${r.videos} numeric=${r.numeric_scores} outliers=${r.trusted_outliers} channels=${r.channels}`);
  }
}

async function nextTargets(cursor: Cursor | null, remaining: number | null): Promise<Target[]> {
  const cap = Math.min(opts.batchSize, remaining ?? opts.batchSize);
  if (cap <= 0) return [];
  return q(
    `select v.id, v.channel_id, v.published_at::text as published_at,
            extract(epoch from (now() - v.published_at))/86400.0 as age_days
       from videos v
       left join video_scores s on s.video_id = v.id
      where ${eligibleWhere('v')}
        and ($4::bool or s.video_id is null or s.model_version <> $3 or s.score is null)
        and ($5::timestamptz is null or (v.published_at, v.id) < ($5::timestamptz, $6::text))
      order by v.published_at desc, v.id desc
      limit $7`,
    [opts.days, opts.minAgeDays, opts.modelVersion, opts.force, cursor?.published_at ?? null, cursor?.id ?? '', cap]
  );
}

async function writeScores(targets: Target[], globalParams: GlobalParams): Promise<{ written: number; skipped: number }> {
  const ids = targets.map((target) => target.id);
  const priorsOf = await priorsFor(ids);
  const priorIds = [...new Set([...priorsOf.values()].flat())];
  const allIds = [...new Set([...ids, ...priorIds])];
  const [targetRecords, priorRecords, truth, metas] = await Promise.all([
    records(ids),
    records(priorIds),
    day30(allIds),
    meta(allIds),
  ]);

  const values: unknown[] = [];
  const tuples: string[] = [];
  let skipped = 0;

  for (const target of targets) {
    const priorV30: number[] = [];
    const priorSameAge: number[] = [];
    const priorMultLogs: number[] = [];
    let fromLifetime = 0;

    const finalPath = shouldUseFinalPath(Number(target.age_days));
    const targetMeta = metas.get(target.id);
    const targetSnaps = targetRecords.get(target.id);
    const self = finalPath ? v30Of(target.id, truth, metas, globalParams.longtail) : null;

    if (finalPath && (!self || !targetMeta)) {
      skipped++;
      continue;
    }
    if (!finalPath && !targetSnaps?.length) {
      skipped++;
      continue;
    }

    const latest = finalPath
      ? { day: Math.min(Number(target.age_days), 30), views: targetMeta!.views }
      : targetSnaps![targetSnaps!.length - 1];
    const bucket = bucketFor(latest.day);
    const tol = bucket <= 3 ? 1 : bucket <= 7 ? 2 : 3;

    for (const priorId of priorsOf.get(target.id) ?? []) {
      const est = v30Of(priorId, truth, metas, globalParams.longtail);
      if (est) {
        priorV30.push(est.v30);
        if (est.fromLifetime) fromLifetime++;
      }

      if (!finalPath) {
        const ps = priorRecords.get(priorId);
        const p30 = truth.get(priorId);
        if (ps) {
          const near = ps
            .filter((s) => Math.abs(s.day - latest.day) <= Math.max(1, latest.day / 4))
            .sort((a, b) => Math.abs(a.day - latest.day) - Math.abs(b.day - latest.day))[0];
          if (near) priorSameAge.push(near.views);

          const nearB = ps
            .filter((s) => Math.abs(s.day - bucket) <= tol)
            .sort((a, b) => Math.abs(a.day - bucket) - Math.abs(b.day - bucket))[0];
          if (nearB && p30) priorMultLogs.push(Math.log(p30 / nearB.views));
        }
      }
    }

    const out = finalPath
      ? (() => {
          const baseline = priorV30.length >= 3 ? median(priorV30) : null;
          const score = baseline && baseline > 0 ? self!.v30 / baseline : null;
          return {
            q: null,
            est30: self!.v30,
            baseline,
            nBaseline: priorV30.length,
            score,
            sameAgeRatio: null,
            nSameAge: 0,
            confidence: priorV30.length < 3 ? 'insufficient' as const : 'confirmed' as const,
            priorsFromLifetime: fromLifetime,
          };
        })()
      : scoreVideo({
          vt: latest.views,
          day: latest.day,
          snaps: targetSnaps!,
          priorMultLogs,
          priorV30,
          priorSameAge,
          priorsFromLifetime: fromLifetime,
          params: globalParams,
        });

    const offset = values.length;
    values.push(
      target.id,
      target.channel_id,
      opts.modelVersion,
      latest.day,
      latest.views,
      out.q,
      out.est30,
      out.baseline,
      out.nBaseline,
      out.score,
      out.sameAgeRatio,
      out.nSameAge,
      out.confidence,
      out.priorsFromLifetime
    );
    tuples.push(`($${offset + 1},$${offset + 2},$${offset + 3},now(),$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11},$${offset + 12},$${offset + 13},$${offset + 14})`);
  }

  if (!tuples.length) return { written: 0, skipped };
  await pool.query(
    `insert into video_scores (video_id, channel_id, model_version, scored_at, snapshot_day, views, q, est30, baseline, n_baseline, score, same_age_ratio, n_same_age, confidence, priors_from_lifetime)
     values ${tuples.join(',')}
     on conflict (video_id) do update set channel_id=excluded.channel_id, model_version=excluded.model_version, scored_at=excluded.scored_at,
       snapshot_day=excluded.snapshot_day, views=excluded.views, q=excluded.q, est30=excluded.est30, baseline=excluded.baseline,
       n_baseline=excluded.n_baseline, score=excluded.score, same_age_ratio=excluded.same_age_ratio, n_same_age=excluded.n_same_age,
       confidence=excluded.confidence, priors_from_lifetime=excluded.priors_from_lifetime`,
    values
  );

  return { written: tuples.length, skipped };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing');
  const globalParams = await params();
  log(`semantic score backfill: model=${opts.modelVersion} params=${opts.paramsVersion} days=${opts.days} min_age=${opts.minAgeDays} batch=${opts.batchSize} ${opts.write ? 'WRITE' : 'DRY-RUN'}`);
  await coverageReport();

  if (!opts.write) {
    log('dry-run complete; rerun with --write after Supabase org usage is checked');
    return;
  }

  const loaded = loadCheckpoint();
  const state: Checkpoint = loaded ?? {
    modelVersion: opts.modelVersion,
    days: opts.days,
    minAgeDays: opts.minAgeDays,
    cursor: null,
    written: 0,
    skipped: 0,
  };
  if (loaded) log(`resuming from ${opts.checkpoint}: written=${state.written} skipped=${state.skipped}`);

  while (opts.limit == null || state.written + state.skipped < opts.limit) {
    const remaining = opts.limit == null ? null : opts.limit - state.written - state.skipped;
    const targets = await nextTargets(state.cursor, remaining);
    if (!targets.length) break;

    const result = await writeScores(targets, globalParams);
    state.written += result.written;
    state.skipped += result.skipped;
    const last = targets[targets.length - 1];
    state.cursor = { published_at: last.published_at, id: last.id };
    saveCheckpoint(state);
    log(`progress: seen=${state.written + state.skipped} written=${state.written} skipped=${state.skipped} cursor=${last.published_at}/${last.id}`);
    await sleep(opts.sleepMs);
  }

  log(`done: written=${state.written} skipped=${state.skipped}`);
  await coverageReport();
}

try {
  await main();
} finally {
  await pool.end();
}
