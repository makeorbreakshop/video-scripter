// Score the scorer: grade every claim the model made against the day-30 count that settled it.
//
//   npx tsx scripts/scorecard-refresh.ts                 both sources, write to `scorecard`
//   npx tsx scripts/scorecard-refresh.ts --source history [--months 12] [--dry]
//   npx tsx scripts/scorecard-refresh.ts --source benchmark [--rows docs/benchmarks/x.rows.csv]
//
// TWO SOURCES, never mixed in a cell.
//
//   history    `video_score_history` -- the numbers the app actually put in front of Brandon.
//              This is the one that matters, and TODAY IT IS EMPTY AND CANNOT FILL.
//
//              Two reasons, and the second is the one that needs a decision. (1) The table only
//              began on 2026-09-02, so nothing in it is 30 days old yet. (2) The R2 readings
//              archive shipped the same week with `historyDays: 14`
//              (lib/readings/retention.ts): rows older than fourteen days are deleted from
//              Postgres. A claim made at age t can only be graded once the video reaches day 30,
//              which is 23-29 days after the claim was written -- so under a 14-day retention
//              EVERY gradable claim has already been deleted by the time it becomes gradable.
//              This source is a no-op until either `historyDays` rises past ~45 or this script
//              learns to read the Parquet archive in the `channelsmith-readings` bucket.
//              Measured 2026-09-08: the join returns 0 rows at every age.
//   benchmark  the per-row dump from scripts/benchmark-scores.ts -- the REAL scorer
//              (core.scoreVideo) replayed as of each age with everything after that instant
//              hidden, against the same day-30 truth. Not the production write path, but the
//              same math on the same population, and it exists today.
//
// Reads: video_score_history, view_snapshots, channels, thumbnail_versions, title_versions,
// feed_events, docs/benchmarks/*.rows.csv. Writes: scorecard.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'node:fs';
import path from 'node:path';
import { makeTimedPool } from '../lib/admin/db';
import { chunk } from '../lib/nightly/tracking-core';
import {
  buildScorecard, bucketForAge, ageTolerance, AGE_BUCKETS,
  type ScorecardCell, type ScorecardRow,
} from '../lib/scoring/scorecard';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const has = (k: string) => process.argv.includes(k);

const SOURCE = arg('--source') ?? 'both';
const MONTHS = Number(arg('--months') ?? 12);
const MODEL = arg('--model-version') ?? null;   // history is mostly labelled 'v5.1-rss'; default: all
const ROWS_CSV = arg('--rows');
const OUT_DIR = arg('--benchmarks') ?? 'docs/benchmarks';
const DRY = has('--dry');
const STAGE_MS = Number(arg('--stage-timeout') ?? 300_000);

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: STAGE_MS });
const q = async (sql: string, params?: any[]): Promise<any[]> => (await pool.query(sql, params)).rows as any[];
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

// ------------------------------------------------------------------ shared bits

/** Subscriber counts for a set of channels. */
async function subsOf(channelIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (const g of chunk([...new Set(channelIds.filter(Boolean))], 2000)) {
    for (const r of await q(`select channel_id as id, subscriber_count from channels where channel_id = any($1)`, [g])) {
      out.set(r.id, r.subscriber_count == null ? null : Number(r.subscriber_count));
    }
  }
  return out;
}

/** Coverage start for packaging history — before this a swap left no record at all. */
const PACKAGING_COVERAGE_START = '2026-09-01';

// --------------------------------------------------------------- history source

async function fromHistory(): Promise<{ rows: ScorecardRow[]; note: string }> {
  // Truth first: it is the scarce side (videos old enough to HAVE a day-30 count), and driving
  // from it keeps video_score_history off a sequential scan — 2.6M rows, 12 s when scanned.
  // The `videos` join is deliberately absent: it cost 27 s of index-only scan with 71K heap
  // fetches and bought only a publish-date filter that snapshot_date already approximates.
  log(`history: day-27..33 truths from the last ${MONTHS} months`);
  const truth = await q(
    `select distinct on (s.video_id) s.video_id, s.view_count::float8 as actual30
       from view_snapshots s
      where s.days_since_published between 27 and 33 and s.view_count > 0
        and s.snapshot_date > current_date - ($1 || ' months')::interval
      order by s.video_id, abs(s.days_since_published - 30)`,
    [MONTHS]
  );
  log(`history: ${truth.length} videos with an outcome`);
  const actual = new Map<string, number>(truth.map((r: any) => [r.video_id, Number(r.actual30)]));

  const modelFilter = MODEL ? `and h.model_version = $2` : '';
  const out: ScorecardRow[] = [];
  const ids = [...actual.keys()];
  // One pass per age bucket: `distinct on (video_id) ... order by abs(age_days - t)` is the
  // claim nearest that age, which is exactly what the benchmark picks.
  for (const t of AGE_BUCKETS) {
    const tol = ageTolerance(t);
    let n = 0;
    for (const g of chunk(ids, 20_000)) {
      const args: any[] = [g];
      if (MODEL) args.push(MODEL);
      const rows = await q(
        `select distinct on (h.video_id)
                h.video_id, h.channel_id, h.age_days, h.est30, h.score, h.baseline, h.confidence,
                h.extra->>'typical_kind' as typical_kind
           from video_score_history h
          where h.video_id = any($1) ${modelFilter}
            and h.age_days between ${t - tol} and ${t + tol}
            and h.est30 > 0
          order by h.video_id, abs(h.age_days - ${t})`,
        args
      );
      n += rows.length;
      for (const r of rows) {
        out.push({
          videoId: r.video_id, t, ageDays: Number(r.age_days),
          est30: Number(r.est30), actual30: actual.get(r.video_id)!,
          score: r.score == null ? null : Number(r.score),
          baseline: r.baseline == null ? null : Number(r.baseline),
          confidence: r.confidence ?? null, typicalKind: r.typical_kind ?? null,
          subscribers: null, changedAfter: null,
        });
      }
    }
    log(`history: t=${t} -> ${n} claims`);
  }
  if (!out.length) {
    return {
      rows: [],
      note: `video_score_history has nothing gradable: it began 2026-09-02, and retention.historyDays ` +
            `is 14 -- a claim becomes gradable ~23-29 days after it is written, by which time it has ` +
            `been deleted. Needs historyDays >= ~45, or a reader for the R2 archive.`,
    };
  }
  await decorate(out);
  return { rows: out, note: `${out.length} graded claims from video_score_history` };
}

/** Fill in subscriber counts and the packaging-change flag on a set of rows. */
async function decorate(rows: ScorecardRow[]): Promise<void> {
  const byId = new Map<string, ScorecardRow[]>();
  for (const r of rows) { const a = byId.get(r.videoId); if (a) a.push(r); else byId.set(r.videoId, [r]); }
  const ids = [...byId.keys()];

  const chOf = new Map<string, string>();
  const pubOf = new Map<string, number>();
  for (const g of chunk(ids, 5000)) {
    for (const r of await q(
      `select id, channel_id, extract(epoch from published_at)*1000 as pub from videos where id = any($1)`, [g]
    )) { chOf.set(r.id, r.channel_id); pubOf.set(r.id, Number(r.pub)); }
  }
  const subs = await subsOf([...chOf.values()]);
  const COVER = new Date(`${PACKAGING_COVERAGE_START}T00:00:00Z`).getTime();

  // Packaging changes, as ages in days. Same three sources the benchmark uses.
  const changes = new Map<string, number[]>();
  for (const g of chunk(ids, 3000)) {
    for (const r of await q(
      `with pkg as (
         select video_id, first_seen as at from thumbnail_versions where version >= 2 and video_id = any($1)
         union all
         select video_id, first_seen from title_versions
          where version >= 2 and coalesce(backfill,false) = false and video_id = any($1)
         union all
         select video_id, at from feed_events
          where type in ('thumbnail_change','ab_rotation','title_change') and video_id = any($1))
       select p.video_id, extract(epoch from (p.at - v.published_at))/86400.0 as age
         from pkg p join videos v on v.id = p.video_id where p.at >= v.published_at`, [g]
    )) {
      const a = changes.get(r.video_id); const age = Number(r.age);
      if (a) a.push(age); else changes.set(r.video_id, [age]);
    }
  }

  for (const [id, rs] of byId) {
    const s = subs.get(chOf.get(id) ?? '') ?? null;
    const covered = (pubOf.get(id) ?? 0) >= COVER;
    const ages = changes.get(id) ?? [];
    for (const r of rs) {
      r.subscribers = s;
      // Only a video published inside the coverage window can say "no change" and mean it.
      r.changedAfter = ages.some((a) => a > r.ageDays && a <= 33) ? true : covered ? false : null;
    }
  }
}

// ------------------------------------------------------------- benchmark source

/** The newest `*.rows.csv` the benchmark has written, or the one BASELINE.json points at. */
function newestRowsCsv(): string | null {
  if (ROWS_CSV) return ROWS_CSV;
  if (!fs.existsSync(OUT_DIR)) return null;
  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.rows.csv'));
  if (!files.length) return null;
  files.sort();
  return path.join(OUT_DIR, files[files.length - 1]);
}

async function fromBenchmark(): Promise<{ rows: ScorecardRow[]; note: string }> {
  const file = newestRowsCsv();
  if (!file || !fs.existsSync(file)) return { rows: [], note: 'no benchmark rows csv found' };
  log(`benchmark: ${file}`);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const head = lines[0].split(',');
  const col = (name: string) => head.indexOf(name);
  const [iVid, iCh, iSplit, iT, iDay, iEst, iAct, iBase, iScore, iConf, iCov, iChanged] =
    ['video_id', 'channel_id', 'split', 't', 'day', 'est30', 'actual30', 'baseline', 'score',
     'confidence', 'coverage', 'changed'].map(col);
  const num = (s: string) => (s === '' || s == null ? null : Number(s));
  const rows: ScorecardRow[] = [];
  // A video in both splits appears twice; keep one claim per (video, age) so a heldout video
  // is not counted twice against a time-split one.
  const seen = new Set<string>();
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    const key = `${f[iVid]}|${f[iT]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const est30 = Number(f[iEst]), actual30 = Number(f[iAct]);
    if (!(est30 > 0) || !(actual30 > 0)) continue;
    rows.push({
      videoId: f[iVid], t: Number(f[iT]), ageDays: Number(f[iDay]), est30, actual30,
      score: num(f[iScore]), baseline: num(f[iBase]), confidence: f[iConf] || null,
      // The replay runs through core.scoreVideo (the v3 mechanism), which has no channelCurve
      // and therefore no measured/estimated distinction to report.
      typicalKind: null,
      subscribers: null,
      // The CSV already carries the benchmark's own coverage-aware answer.
      changedAfter: f[iCov] === 'full' ? f[iChanged] === '1' : f[iChanged] === '1' ? true : null,
    });
  }
  log(`benchmark: ${rows.length} claims`);
  const chOf = new Map<string, string>();
  for (const line of lines.slice(1)) { const f = line.split(','); chOf.set(f[iVid], f[iCh]); }
  const subs = await subsOf([...chOf.values()]);
  for (const r of rows) r.subscribers = subs.get(chOf.get(r.videoId) ?? '') ?? null;
  return { rows, note: `${rows.length} replayed claims from ${path.basename(file)}` };
}

// ------------------------------------------------------------------------ write

async function store(source: string, cells: ScorecardCell[], computedAt: Date): Promise<void> {
  if (!cells.length) { log(`${source}: nothing to store`); return; }
  for (const g of chunk(cells, 100)) {
    const vals: any[] = []; const tuples: string[] = [];
    for (const c of g) {
      const k = vals.length;
      vals.push(computedAt, source, c.dimension, c.bucket, JSON.stringify(c.metrics));
      tuples.push(`($${k + 1},$${k + 2},$${k + 3},$${k + 4},$${k + 5})`);
    }
    await pool.query(
      `insert into scorecard (computed_at, source, dimension, bucket, metrics) values ${tuples.join(',')}
       on conflict (computed_at, source, dimension, bucket) do update set metrics = excluded.metrics`,
      vals
    );
  }
  log(`${source}: stored ${cells.length} cells at ${computedAt.toISOString()}`);
}

function print(source: string, cells: ScorecardCell[]): void {
  console.log(`\n=== ${source} ===`);
  let dim = '';
  for (const c of cells) {
    if (c.dimension !== dim) {
      dim = c.dimension;
      console.log(`\n${dim}`);
      console.log('  bucket        n      medALE    bias     P     R     F1    callable');
    }
    const m = c.metrics;
    const f = (x: number | null, d = 3) => (x == null ? '  -  ' : x.toFixed(d).padStart(6));
    console.log(`  ${c.bucket.padEnd(12)} ${String(m.n).padStart(6)}  ${f(m.medALE)}  ${f(m.bias)} ${f(m.precision, 2)} ${f(m.recall, 2)} ${f(m.f1, 2)}  ${String(m.nCallable).padStart(6)}`);
  }
}

// -------------------------------------------------------------------------- run

export interface RefreshResult { source: string; cells: number; rows: number; note: string }

const computedAt = new Date();
const results: RefreshResult[] = [];
for (const source of SOURCE === 'both' ? ['history', 'benchmark'] : [SOURCE]) {
  const { rows, note } = source === 'history' ? await fromHistory() : await fromBenchmark();
  // Only claims that landed in a declared age bucket are graded; the rest are not comparable.
  const graded = rows.filter((r) => bucketForAge(r.ageDays) != null);
  const cells = buildScorecard(graded);
  print(source, cells);
  log(`${source}: ${note}`);
  if (!DRY) await store(source, cells, computedAt);
  results.push({ source, cells: cells.length, rows: graded.length, note });
}
console.log(`\n${JSON.stringify(results, null, 2)}`);
await pool.end();
