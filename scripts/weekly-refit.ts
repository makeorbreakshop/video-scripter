// Refit on a schedule, promote on evidence.
//
//   npx tsx scripts/weekly-refit.ts                 fit, gate, promote or reject, write the eval
//   npx tsx scripts/weekly-refit.ts --dry-run       fit and gate, decide, PROMOTE NOTHING
//   npx tsx scripts/weekly-refit.ts --no-fit        gate the newest existing candidate instead
//
// ---------------------------------------------------------------------------------------------
// WHAT CHANGED, AND WHAT HAPPENS TO THE NIGHTLY FIT
//
// Until 2026-09-08 `score-videos.ts --fit` ran at 04:15 and its new `score_params` row was live
// the instant it committed, because every reader took "the newest row for this model_version".
// A refit is a model change. It was going out nightly, unbenchmarked, on a cron.
//
// The choice made here is the simplest one that fixes it: THE NIGHTLY FIT BECOMES CANDIDATE-ONLY
// AND THIS JOB IS THE ONLY PROMOTER. The 04:15 job keeps running unchanged and keeps producing a
// fresh fit every night — that fit is just no longer live. On Sunday at 05:00 this job fits once
// more (so the candidate it judges is the one it measured, not a six-day-old row), runs the three
// harnesses against the current champion, and moves the pointer only if every gate passes.
//
// The alternative — leave the nightly fit live and gate only weekly — was rejected: it would mean
// six nights a week of ungated model changes, which is the thing being fixed. The cost of this
// choice is that a fit sits unused for up to a week, which for a corpus-wide nuisance table
// refitted from 27K videos is not a cost at all.
//
// ---------------------------------------------------------------------------------------------
// THE GATES (thresholds and the verdict logic: lib/scoring/refit-gates.ts)
//
//   1. estimate     backtest-baseline-trend --estimate-coverage. THE ONLY GATE THAT SEES v5.3:
//                   the other two replay through core.scoreVideo and are structurally blind to
//                   channelCurve. medALE on the >3d mask may not exceed the recorded champion's
//                   by more than max(0.005, 3% of it).
//   2. benchmark    benchmark-scores.ts --compare against docs/benchmarks/BASELINE.json. No cell
//                   worse on medALE past max(0.005, 3% of ref) or on F1 past 0.03. `no_change`
//                   is read before `pooled`, because packaging coverage starts 2026-09-01 and
//                   pooled silently contains unseen swaps.
//   3. stability    median churn on unchanged-truth pairs may not rise by more than 0.03.
//   4. calibration  held-out band coverage: inner near 50%, outer near 80%, ±5 points.
//
// An inconclusive gate is NOT a pass. Every run writes one `model_evals` row either way.
//
// ---------------------------------------------------------------------------------------------
// SAFETY
//
// * Every query this script makes goes through makeTimedPool (`begin; set local
//   statement_timeout`), which Postgres enforces itself. The three harnesses do the same. So a
//   stage killed on its wall-clock budget cannot leave a backend reading: that is precisely the
//   failure that orphaned queries during the 2026-09-08 v5.3 attempt.
// * Each stage is spawned as its own process with a hard timeout and is killed by process GROUP,
//   so a stage that hangs takes its children with it.
// * Preflight: if pg_stat_activity shows another heavy job already running, this job SKIPS with
//   a logged reason and a `skipped` eval row rather than piling on top of it.
//
// Reads: score_params, pg_stat_activity, docs/benchmarks/*. Writes: score_params.status,
// model_evals, docs/benchmarks/*, docs/benchmarks/CHANGELOG.md, scorecard (via scorecard-refresh).
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeTimedPool } from '../lib/admin/db';
import { MODEL_VERSION } from '../lib/scoring/core';
import { compareReports, type BenchmarkReport } from '../lib/scoring/benchmark';
import {
  benchmarkGate, stabilityGate, calibrationGate, estimateGate, decide,
  type CellDeltaInput, type GateSet, type StabilityInput,
} from '../lib/scoring/refit-gates';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const has = (k: string) => process.argv.includes(k);

const DRY = has('--dry-run');
const NO_FIT = has('--no-fit');
const SKIP_SCORECARD = has('--skip-scorecard');
const OUT_DIR = arg('--out') ?? 'docs/benchmarks';
/** Per-stage wall clock, minutes. The 2026-09-08 estimate-coverage run took 8m45s. */
const STAGE_MIN = Number(arg('--stage-minutes') ?? 60);
/** Harness sizes, so a smoke run can be small without editing the harnesses. */
const TEST_LIMIT = arg('--test-limit');
const FIT_SAMPLE = arg('--fit-sample');
const MONTHS = arg('--months');
const ESTIMATE_LIMIT = arg('--estimate-limit');
const CALIBRATION_TARGET = arg('--calibration-target');

/**
 * The champion's recorded estimate-slide medALE on the >3d mask (docs/benchmarks/CHANGELOG.md,
 * 2026-09-08 evidence pass). Used only when no previous promoted eval carries one.
 */
const FALLBACK_ESTIMATE_MEDALE = 0.1834;

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: 120_000 });
const q = async (sql: string, params?: any[]): Promise<any[]> => (await pool.query(sql, params)).rows as any[];
const log = (m: string) => console.log(`${new Date().toISOString()} [weekly-refit] ${m}`);

// ------------------------------------------------------------------ stage runner

interface StageOut { code: number | null; stdout: string; timedOut: boolean }

/**
 * Run one harness as its own process with a hard budget.
 *
 * `detached` so the kill hits the whole process group: tsx spawns, and killing only the parent
 * would leave the child running against the database. The harnesses' own `set local
 * statement_timeout` is what guarantees the DATABASE side stops too.
 */
function stage(name: string, args: string[], minutes = STAGE_MIN): Promise<StageOut> {
  return new Promise((resolve) => {
    log(`stage ${name}: npx tsx ${args.join(' ')}  (budget ${minutes}m)`);
    const started = Date.now();
    const child = spawn('npx', ['tsx', ...args], {
      cwd: process.cwd(),
      env: { ...process.env, WEEKLY_REFIT_EMIT: '1' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let timedOut = false;
    const kill = setTimeout(() => {
      timedOut = true;
      log(`stage ${name}: BUDGET EXCEEDED at ${minutes}m — killing process group`);
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
    }, minutes * 60_000);
    child.stdout.on('data', (d) => { const s = String(d); stdout += s; process.stdout.write(s); });
    child.stderr.on('data', (d) => { const s = String(d); stdout += s; process.stderr.write(s); });
    child.on('close', (code) => {
      clearTimeout(kill);
      log(`stage ${name}: exit ${code}${timedOut ? ' (timed out)' : ''} after ${((Date.now() - started) / 1000).toFixed(0)}s`);
      resolve({ code, stdout, timedOut });
    });
  });
}

// -------------------------------------------------------------------- preflight

/**
 * Is something heavy already running? Piling a second full-corpus scan on top of the archive or
 * a rescore is how the database became IO-bound on 2026-09-08.
 */
async function busyReason(): Promise<string | null> {
  const rows = await q(
    `select pid, state, now() - query_start as running, left(query, 120) as query
       from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid()
        and state = 'active' and query_start < now() - interval '2 minutes'
        and query not ilike '%pg_stat_activity%'
      order by query_start asc`
  );
  if (!rows.length) return null;
  return `${rows.length} query(ies) already running >2m, oldest ${rows[0].running}: ${String(rows[0].query).replace(/\s+/g, ' ')}`;
}

// -------------------------------------------------------------------- eval write

async function writeEval(o: {
  verdict: string; candidateId: number | null; gates: Record<string, unknown>;
  worstCell: string | null; notes: string;
}): Promise<number> {
  const rows = await q(
    `insert into model_evals (model_version, candidate_params_id, verdict, gates, worst_cell, notes)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [MODEL_VERSION, o.candidateId, o.verdict, JSON.stringify(o.gates), o.worstCell, o.notes]
  );
  return Number(rows[0].id);
}

// -------------------------------------------------------------------- parse bits

/** `::params-id=NN`, emitted by the fitters under WEEKLY_REFIT_EMIT. */
const parseParamsId = (s: string): number | null => {
  const m = [...s.matchAll(/::params-id=(\d+)/g)].pop();
  return m ? Number(m[1]) : null;
};

/** `wrote docs/benchmarks/<stem>.{json,md,rows.csv}` */
const parseBenchStem = (s: string): string | null => {
  const m = [...s.matchAll(/wrote (\S+)\.\{json,md,rows\.csv\}/g)].pop();
  return m ? m[1] : null;
};

/**
 * The `>3d` block of `--estimate-coverage`. That mask is the cell that validates the slide:
 * `>=1d` still reaches the old interpolation path on most rows.
 */
function parseEstimate(s: string): { medALE: number | null; bias: number | null; n: number } {
  const block = s.split('mask keep samples >3d')[1] ?? '';
  const num = (re: RegExp) => { const m = block.match(re); return m ? Number(m[1]) : null; };
  return {
    medALE: num(/medALE \|log\(est\/measured\)\|:\s+([\d.-]+)/),
    bias: num(/bias\s+log\(est\/measured\):\s+([\d.-]+)/),
    n: num(/reached the ESTIMATE branch:\s+(\d+)/) ?? 0,
  };
}

/** The `ALL  n  inner  outer` summary line of check-band-calibration. */
function parseCalibration(s: string): { inner: number | null; outer: number | null; n: number } {
  const m = [...s.matchAll(/^ALL\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s*$/gm)].pop();
  return m ? { n: Number(m[1]), inner: Number(m[2]), outer: Number(m[3]) } : { n: 0, inner: null, outer: null };
}

const readJson = <T,>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8')) as T;

/** Stability rows shared by both reports, as the gate wants them. */
function stabilityRows(cand: BenchmarkReport, ref: BenchmarkReport): StabilityInput[] {
  const out: StabilityInput[] = [];
  for (const [split, pairs] of Object.entries(cand.stability ?? {})) {
    const refPairs = (ref.stability ?? {})[split] ?? {};
    for (const [pair, cell] of Object.entries(pairs)) {
      out.push({ split, pair, candChurn: cell.medianChurn ?? null, refChurn: refPairs[pair]?.medianChurn ?? null });
    }
  }
  return out;
}

// -------------------------------------------------------------------------- run

const startedAt = new Date();
log(`${MODEL_VERSION}${DRY ? '  [DRY RUN — nothing will be promoted]' : ''}`);

const busy = await busyReason();
if (busy) {
  log(`SKIP: ${busy}`);
  const id = await writeEval({
    verdict: 'skipped', candidateId: null, gates: { preflight: { pass: false, reason: busy } },
    worstCell: null, notes: `skipped: ${busy}`,
  });
  log(`model_evals id=${id} verdict=skipped`);
  await pool.end();
  process.exit(0);
}
log('preflight: database quiet');

// ---- 1. the candidate params ----------------------------------------------------------------
let candidateId: number | null = null;
if (NO_FIT) {
  const rows = await q(
    `select id from score_params where model_version = $1 and status = 'candidate'
      order by fitted_at desc limit 1`, [MODEL_VERSION]);
  candidateId = rows.length ? Number(rows[0].id) : null;
  log(`--no-fit: gating existing candidate id=${candidateId ?? 'none'}`);
} else {
  const out = await stage('fit', ['scripts/score-videos.ts', '--fit']);
  candidateId = parseParamsId(out.stdout);
  if (out.code !== 0 || !candidateId) {
    const notes = `fit stage failed (exit ${out.code}${out.timedOut ? ', timed out' : ''})`;
    await writeEval({ verdict: 'error', candidateId: null, gates: { fit: { pass: false, notes } }, worstCell: null, notes });
    log(notes); await pool.end(); process.exit(1);
  }
}
if (!candidateId) {
  const notes = 'no candidate score_params row to judge';
  await writeEval({ verdict: 'error', candidateId: null, gates: {}, worstCell: null, notes });
  log(notes); await pool.end(); process.exit(1);
}
log(`candidate score_params id=${candidateId}`);

// ---- 2. bands for the candidate --------------------------------------------------------------
// check-band-calibration needs a row that carries `bands`, and a --fit row never does.
const bandsOut = await stage('bands', [
  'scripts/fit-forecast-bands.ts', '--from-params', String(candidateId),
  ...(MONTHS ? ['--months', MONTHS] : []),
]);
const bandsId = parseParamsId(bandsOut.stdout);
log(`candidate bands score_params id=${bandsId ?? 'none'}`);

// ---- 3. gate: the estimate slide (the only one that sees v5.3) -------------------------------
const estOut = await stage('estimate-coverage', [
  'scripts/backtest-baseline-trend.ts', '--estimate-coverage', '--params-id', String(candidateId),
  ...(ESTIMATE_LIMIT ? ['--limit', ESTIMATE_LIMIT] : []),
]);
const est = parseEstimate(estOut.stdout);

// The reference: the last PROMOTED eval's own number, else the recorded champion's.
const prior = await q(
  `select gates->'estimate'->'detail'->>'medALE' as medale from model_evals
    where verdict = 'promoted' and gates->'estimate'->'detail' ? 'medALE'
    order by run_at desc limit 1`
);
const refEstimate = prior.length && prior[0].medale != null ? Number(prior[0].medale) : FALLBACK_ESTIMATE_MEDALE;
log(`estimate reference medALE ${refEstimate} (${prior.length ? 'last promoted eval' : 'CHANGELOG 2026-09-08'})`);

// ---- 4. gate: benchmark + stability -----------------------------------------------------------
const benchOut = await stage('benchmark', [
  'scripts/benchmark-scores.ts', '--params-id', String(candidateId), '--out', OUT_DIR,
  ...(TEST_LIMIT ? ['--test-limit', TEST_LIMIT] : []),
  ...(FIT_SAMPLE ? ['--fit-sample', FIT_SAMPLE] : []),
  ...(MONTHS ? ['--months', MONTHS] : []),
]);
const stem = parseBenchStem(benchOut.stdout);
let cells: CellDeltaInput[] | null = null;
let stability: StabilityInput[] = [];
let candReport: BenchmarkReport | null = null;
let refPath: string | null = null;
if (stem && fs.existsSync(`${stem}.json`)) {
  candReport = readJson<BenchmarkReport>(`${stem}.json`);
  const ptr = readJson<{ run: string }>(path.join(OUT_DIR, 'BASELINE.json'));
  refPath = path.join(OUT_DIR, ptr.run);
  const refReport = readJson<BenchmarkReport>(refPath);
  const cmp = compareReports(candReport, refReport);
  cells = cmp.deltas as unknown as CellDeltaInput[];
  stability = stabilityRows(candReport, refReport);
  log(`benchmark: ${stem}.json vs ${refPath} — ${cmp.summary.better} better / ${cmp.summary.wash} wash / ${cmp.summary.worse} worse`);
} else {
  log('benchmark: no report produced');
}

// ---- 5. gate: band calibration ----------------------------------------------------------------
const calOut = bandsId
  ? await stage('band-calibration', [
      'scripts/check-band-calibration.ts', '--params-id', String(bandsId),
      ...(CALIBRATION_TARGET ? ['--target', CALIBRATION_TARGET] : []),
      ...(MONTHS ? ['--months', MONTHS] : []),
    ])
  : { code: 1, stdout: '', timedOut: false };
const cal = parseCalibration(calOut.stdout);

// ---- 6. the verdict ---------------------------------------------------------------------------
const gates: GateSet = {
  estimate: estimateGate({ ...est, refMedALE: refEstimate }),
  benchmark: benchmarkGate(cells),
  stability: stabilityGate(stability),
  calibration: calibrationGate(cal),
};
const v = decide(gates);

console.log('\n--- gates ---');
for (const [k, g] of Object.entries(gates)) console.log(`${k.padEnd(12)} ${g.status.padEnd(13)} ${g.headline}`);
console.log(`verdict: ${v.verdict}${v.failed.length ? ` (failed: ${v.failed.join(', ')})` : ''}`);
console.log(`worst cell: ${v.worstCell ?? '—'}\n`);

const gatesJson: Record<string, unknown> = Object.fromEntries(
  Object.entries(gates).map(([k, g]) => [k, { status: g.status, headline: g.headline, detail: g.detail }])
);
gatesJson.run = {
  candidateParamsId: candidateId, bandsParamsId: bandsId,
  benchmarkRun: stem ? path.basename(`${stem}.json`) : null, benchmarkReference: refPath,
  dryRun: DRY, startedAt: startedAt.toISOString(),
};

// ---- 7. promote or reject ---------------------------------------------------------------------
const evalId = await writeEval({
  verdict: DRY ? 'skipped' : v.verdict, candidateId, gates: gatesJson,
  worstCell: v.worstCell, notes: DRY ? `dry run — ${v.verdict} not applied. ${v.notes}` : v.notes,
});
log(`model_evals id=${evalId}`);

if (DRY) {
  log(`DRY RUN: would have ${v.verdict === 'promoted' ? 'PROMOTED' : 'REJECTED'} score_params id=${candidateId}. Nothing written.`);
} else if (v.verdict === 'promoted') {
  // The bands row is the one that carries everything: it is the candidate params verbatim plus
  // a band table. Promoting the bare params row too would leave the newest active row band-less.
  const promote = bandsId ?? candidateId;
  await q(
    `update score_params set status = 'active', status_at = now(), status_note = $2 where id = $1`,
    [promote, `promoted by weekly-refit eval ${evalId}`]
  );
  if (bandsId && bandsId !== candidateId) {
    await q(`update score_params set status = 'rejected', status_at = now(), status_note = $2 where id = $1`,
      [candidateId, `superseded by its own bands row ${bandsId} (eval ${evalId})`]);
  }
  log(`PROMOTED score_params id=${promote} to active`);

  // The run that justified the promotion becomes the reference the next one is judged against.
  if (stem && candReport) {
    fs.writeFileSync(path.join(OUT_DIR, 'BASELINE.json'), JSON.stringify({
      modelVersion: candReport.modelVersion, run: path.basename(`${stem}.json`),
      rows: path.basename(`${stem}.rows.csv`), recordedAt: new Date().toISOString(),
      promotedBy: `weekly-refit eval ${evalId}`,
    }, null, 2));
    log(`BASELINE.json -> ${path.basename(stem)}.json`);
  }
  const day = new Date().toISOString().slice(0, 10);
  const entry = [
    ``,
    `## ${day} (weekly refit) — score_params ${promote} promoted`,
    ``,
    `Automatic. \`scripts/weekly-refit.ts\`, eval ${evalId}. Candidate \`score_params\` id ${candidateId}` +
      `${bandsId ? ` (bands row ${bandsId})` : ''}, fitted this run, gated against` +
      `${refPath ? ` \`${refPath}\`` : ' the recorded champion'}.`,
    ``,
    `| gate | status | result |`,
    `|---|---|---|`,
    ...Object.entries(gates).map(([k, g]) => `| ${k} | ${g.status} | ${g.headline} |`),
    ``,
    `Worst cell: ${v.worstCell ?? '—'}. No gate may be inconclusive; all four passed.`,
    ``,
  ].join('\n');
  const chPath = path.join(OUT_DIR, 'CHANGELOG.md');
  const ch = fs.readFileSync(chPath, 'utf8');
  const at = ch.indexOf('\n## ');
  fs.writeFileSync(chPath, at < 0 ? ch + entry : ch.slice(0, at) + entry + ch.slice(at));
  log(`CHANGELOG.md: appended ${day} entry`);
} else {
  for (const id of [candidateId, bandsId].filter((x): x is number => x != null)) {
    await q(`update score_params set status = 'rejected', status_at = now(), status_note = $2 where id = $1`,
      [id, `rejected by weekly-refit eval ${evalId}: ${v.notes}`.slice(0, 1000)]);
  }
  log(`REJECTED candidate ${candidateId}${bandsId ? ` and bands ${bandsId}` : ''}; champion unchanged`);
}

// ---- 8. the scorecard --------------------------------------------------------------------------
if (!SKIP_SCORECARD) await stage('scorecard', ['scripts/scorecard-refresh.ts', ...(DRY ? ['--dry'] : [])], 30);

log(`done in ${((Date.now() - startedAt.getTime()) / 1000).toFixed(0)}s`);
await pool.end();
