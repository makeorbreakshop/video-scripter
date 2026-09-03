import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
  bootstrapMeanInterval,
  ndcgAtK,
  pooledRecallAtK,
  precisionAtK,
  type FrozenV4TaskManifest,
  type V4Lane,
} from '../../lib/semantic/eval-v4';
import type { ResolvedV4Judgment, V4JudgmentOutput } from '../../lib/semantic/judgments-v4';
import { costToday, runMain } from './common';

const EVAL_DIR = path.resolve('docs/prd/semantic-eval-v4');
const REPORT_PATH = path.resolve('docs/prd/2026-09-03-semantic-eval-v4.md');

interface StoredCandidate {
  entity_id: string;
  rank: number;
  raw_score: number | null;
  document_hash: string;
}

interface CandidateArtifact {
  run_id: string;
  rankings_hash: string;
  tasks: Array<{
    task_id: string;
    lane: V4Lane;
    split: 'dev' | 'heldout';
    systems: Array<{ system: string; latency_ms: number; candidates: StoredCandidate[] }>;
  }>;
}

interface ResolvedRow {
  task_id: string;
  lane: Exclude<V4Lane, 'J1'>;
  split: 'dev' | 'heldout';
  blind_id: string;
  entity_id: string;
  pass_1: V4JudgmentOutput;
  pass_2: V4JudgmentOutput;
  pass_3?: V4JudgmentOutput;
  resolved: ResolvedV4Judgment;
}

interface ResolvedArtifact {
  candidate_run_id: string;
  candidate_rankings_hash: string;
  agreements: number;
  adjudicated: number;
  unresolved: number;
  judgments: ResolvedRow[];
}

interface BlindArtifact {
  tasks: Array<{
    task: { id: string; lane: V4Lane; [key: string]: unknown };
    candidates: Array<Record<string, unknown> & { blind_id: string; entity_id: string }>;
  }>;
}

interface ProvenanceArtifact {
  tasks: Record<string, Record<string, Array<{ system: string; rank: number }>>>;
}

interface MetricRow {
  task_id: string;
  lane: V4Lane;
  split: 'dev' | 'heldout';
  system: string;
  measure: string;
  value: number;
}

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(EVAL_DIR, name), 'utf8')) as T;
}

function percentile(values: number[], probability: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(probability * sorted.length) - 1] ?? sorted[0];
}

function judgmentMap(rows: ResolvedRow[], value: (row: ResolvedRow) => number): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.entity_id, value(row)]));
}

function addRankingMetrics(
  output: MetricRow[],
  base: Omit<MetricRow, 'measure' | 'value'>,
  ids: string[],
  grades: Record<string, number>,
  prefix = '',
): void {
  output.push(
    { ...base, measure: `${prefix}precision@10`, value: precisionAtK(ids, grades, 10) },
    { ...base, measure: `${prefix}pooled_recall@100`, value: pooledRecallAtK(ids, grades, 100) },
    { ...base, measure: `${prefix}ndcg@20`, value: ndcgAtK(ids, grades, 20) },
  );
}

function summarize(rows: MetricRow[]) {
  const grouped = new Map<string, MetricRow[]>();
  for (const row of rows) {
    const key = [row.split, row.lane, row.system, row.measure].join('\0');
    const values = grouped.get(key) ?? [];
    values.push(row);
    grouped.set(key, values);
  }
  return [...grouped.values()].map((values) => {
    const first = values[0];
    const interval = bootstrapMeanInterval(values.map((row) => row.value), {
      seed: createHash('sha256').update([first.split, first.lane, first.system, first.measure].join('\0')).digest().readUInt32BE(0),
    });
    return {
      split: first.split,
      lane: first.lane,
      system: first.system,
      measure: first.measure,
      tasks: values.length,
      ...interval,
    };
  }).sort((left, right) => [left.split, left.lane, left.measure, left.system].join('|')
    .localeCompare([right.split, right.lane, right.measure, right.system].join('|')));
}

function format(value: number): string {
  return value.toFixed(3);
}

function markdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

async function report(): Promise<void> {
  const [tasks, candidates, resolved, blind, provenance, poolStats, documents] = await Promise.all([
    readJson<FrozenV4TaskManifest>('tasks.json'),
    readJson<CandidateArtifact>('candidate-runs.json'),
    readJson<ResolvedArtifact>('resolved-judgments.json'),
    readJson<BlindArtifact>('blind-pools-pass-1.json'),
    readJson<ProvenanceArtifact>('blind-provenance.json'),
    readJson<{ tasks: Array<{ task_id: string; pool_size: number; overlap_all_three: number }> }>('blind-pool-stats.json'),
    readJson<Record<string, unknown>>('documents.json'),
  ]);
  if (candidates.run_id !== resolved.candidate_run_id || candidates.rankings_hash !== resolved.candidate_rankings_hash) {
    throw new Error('resolved judgments do not match candidate run');
  }
  const taskById = new Map(tasks.tasks.map((task) => [task.id, task]));
  const resolvedByTask = new Map<string, ResolvedRow[]>();
  for (const row of resolved.judgments) {
    const values = resolvedByTask.get(row.task_id) ?? [];
    values.push(row);
    resolvedByTask.set(row.task_id, values);
  }
  const metricRows: MetricRow[] = [];
  for (const taskRun of candidates.tasks) {
    const task = taskById.get(taskRun.task_id);
    if (!task) throw new Error(`unknown candidate task ${taskRun.task_id}`);
    const judgmentRows = resolvedByTask.get(task.id) ?? [];
    for (const system of taskRun.systems) {
      const ids = system.candidates.map((candidate) => candidate.entity_id);
      const base = { task_id: task.id, lane: task.lane, split: task.split, system: system.system };
      if (task.lane === 'J1') {
        const rank = ids.indexOf(task.target_id!);
        metricRows.push({ ...base, measure: 'mrr', value: rank === -1 ? 0 : 1 / (rank + 1) });
        continue;
      }
      if (task.lane === 'J2') {
        addRankingMetrics(metricRows, base, ids, judgmentMap(judgmentRows, (row) => row.resolved as number));
      } else if (task.lane === 'J3') {
        addRankingMetrics(metricRows, base, ids, judgmentMap(judgmentRows, (row) => (row.resolved as { topic: number }).topic), 'topic_');
        addRankingMetrics(metricRows, base, ids, judgmentMap(judgmentRows, (row) => (row.resolved as { packaging: number }).packaging), 'packaging_');
      } else if (task.lane === 'J4') {
        addRankingMetrics(metricRows, base, ids, judgmentMap(judgmentRows, (row) => row.resolved as number));
        metricRows.push({ ...base, measure: 'invalid_outlier_rate@10', value: 0 });
      } else {
        const lower = judgmentMap(judgmentRows, (row) => row.resolved === 'creative_adaptation' ? 1 : 0);
        const upper = judgmentMap(judgmentRows, (row) => row.resolved === 'creative_adaptation' || row.resolved === 'unresolved' ? 1 : 0);
        addRankingMetrics(metricRows, base, ids, lower, 'lower_');
        addRankingMetrics(metricRows, base, ids, upper, 'upper_');
        const direct = ids.slice(0, 10).filter((id) => judgmentRows.find((row) => row.entity_id === id)?.resolved === 'direct_application').length / 10;
        metricRows.push({ ...base, measure: 'direct_application_rate@10', value: direct });
      }
      metricRows.push({ ...base, measure: 'zero_result', value: ids.length ? 0 : 1 });
    }
  }
  const summary = summarize(metricRows);
  const latency = candidates.tasks.flatMap((task) => task.systems.map((system) => ({
    task_id: task.task_id,
    lane: task.lane,
    split: task.split,
    system: system.system,
    latency_ms: system.latency_ms,
  })));
  const latencySummary = [...new Set(latency.map((row) => row.system))].map((system) => {
    const values = latency.filter((row) => row.system === system).map((row) => row.latency_ms);
    return { system, tasks: values.length, p50_ms: percentile(values, 0.5), p95_ms: percentile(values, 0.95) };
  });

  const blindTaskById = new Map(blind.tasks.map((task) => [task.task.id, task]));
  const spotCandidates: Array<{
    priority: number;
    category: string;
    task_id: string;
    blind_id: string;
    candidate: Record<string, unknown>;
    pass_1: V4JudgmentOutput;
    pass_2: V4JudgmentOutput;
    pass_3?: V4JudgmentOutput;
    resolved: ResolvedV4Judgment;
  }> = [];
  for (const row of resolved.judgments) {
    const ranks = provenance.tasks[row.task_id]?.[row.entity_id] ?? [];
    const topTen = ranks.some((rank) => rank.rank <= 10);
    const disagreed = row.pass_3 != null;
    const boundary = row.resolved === 'background' || row.resolved === 'direct_application'
      || row.resolved === 1
      || (typeof row.resolved === 'object' && Object.values(row.resolved).some((value) => value === 1));
    let priority = 99;
    let category = 'sample';
    if (row.resolved === 'unresolved' && topTen) [priority, category] = [0, 'unresolved_top10'];
    else if (disagreed && topTen) [priority, category] = [1, 'disagreement_top10'];
    else if (row.resolved === 'unresolved') [priority, category] = [2, 'unresolved'];
    else if (disagreed && boundary) [priority, category] = [3, 'disagreement_boundary'];
    else if (boundary && topTen) [priority, category] = [4, 'decision_boundary_top10'];
    if (priority === 99) continue;
    const candidate = blindTaskById.get(row.task_id)?.candidates.find((item) => item.blind_id === row.blind_id);
    if (!candidate) throw new Error(`missing blind candidate for spot check ${row.blind_id}`);
    spotCandidates.push({
      priority,
      category,
      task_id: row.task_id,
      blind_id: row.blind_id,
      candidate,
      pass_1: row.pass_1,
      pass_2: row.pass_2,
      ...(row.pass_3 == null ? {} : { pass_3: row.pass_3 }),
      resolved: row.resolved,
    });
  }
  const spotCheck = spotCandidates
    .sort((left, right) => left.priority - right.priority
      || createHash('sha256').update(left.blind_id).digest('hex').localeCompare(createHash('sha256').update(right.blind_id).digest('hex')))
    .slice(0, 20)
    .map(({ priority: _priority, ...row }) => row);
  if (spotCheck.length < 15) throw new Error(`spot-check packet too small: ${spotCheck.length}`);

  const totalCost = await costToday();
  const metricsArtifact = {
    version: 4,
    candidate_run_id: candidates.run_id,
    candidate_rankings_hash: candidates.rankings_hash,
    confidence_intervals: 'task bootstrap, 5000 iterations, descriptive only',
    judgments: {
      total: resolved.judgments.length,
      agreements: resolved.agreements,
      adjudicated: resolved.adjudicated,
      unresolved: resolved.unresolved,
      initial_agreement_rate: resolved.agreements / (resolved.agreements + resolved.adjudicated),
    },
    metric_rows: metricRows,
    summary,
    latency: latencySummary,
    pool_stats: poolStats.tasks,
    semantic_cost_today: totalCost,
    documents,
  };
  await Promise.all([
    fs.writeFile(path.join(EVAL_DIR, 'metrics.json'), `${JSON.stringify(metricsArtifact)}\n`),
    fs.writeFile(path.join(EVAL_DIR, 'brandon-spot-check.json'), `${JSON.stringify({
      version: 4,
      candidate_run_id: candidates.run_id,
      instructions: 'Review candidate relevance and the resolved label. No system identity, score, or rank is shown.',
      items: spotCheck,
    })}\n`),
  ]);

  const heldoutCore = summary.filter((row) => row.split === 'heldout'
    && (row.measure === 'ndcg@20' || row.measure === 'topic_ndcg@20' || row.measure === 'packaging_ndcg@20'
      || row.measure === 'lower_ndcg@20' || row.measure === 'upper_ndcg@20'));
  const devCore = summary.filter((row) => row.split === 'dev'
    && (row.measure === 'ndcg@20' || row.measure === 'topic_ndcg@20' || row.measure === 'packaging_ndcg@20'
      || row.measure === 'lower_ndcg@20' || row.measure === 'upper_ndcg@20'));
  const coverage = summary.filter((row) => row.measure.includes('pooled_recall@100'));
  const heldoutPrecision = summary.filter((row) => row.split === 'heldout'
    && (row.measure.includes('precision@10') || row.measure === 'direct_application_rate@10'));
  const j1 = metricRows.filter((row) => row.lane === 'J1');
  const mean = (lane: V4Lane, system: string, measure: string) => summary.find((row) => (
    row.split === 'heldout' && row.lane === lane && row.system === system && row.measure === measure
  ))?.mean ?? 0;
  const markdown = `# Semantic retrieval v4 evaluation\n\n`
    + `Status: generated from frozen revision-4 artifacts. This is a diagnostic evaluation, not a production-route approval. Confidence intervals are descriptive because each lane has only one or two tasks per split.\n\n`
    + `## Corpus and judging\n\n`
    + `- Video corpus: ${documents.videos} guarded one-year outliers.\n`
    + `- Channel corpus: ${documents.channels} channels.\n`
    + `- Pooled non-J1 judgments: ${resolved.judgments.length}; initial agreement ${format(metricsArtifact.judgments.initial_agreement_rate)}; adjudicated ${resolved.adjudicated}; unresolved ${resolved.unresolved}.\n`
    + `- Semantic cost ledger today: $${totalCost.usd.toFixed(6)} for ${totalCost.tokens.toLocaleString('en-US')} tokens, including earlier revision-4 retries/experiments today.\n\n`
    + `## J1 exact-channel MRR\n\n`
    + markdownTable(['Split', 'Task', 'System', 'MRR'], j1.map((row) => [row.split, row.task_id, row.system, format(row.value)]))
    + `\n\n## Held-out nDCG@20\n\n`
    + markdownTable(['Lane', 'Measure', 'System', 'Mean', '95% CI', 'Tasks'], heldoutCore.map((row) => [
      row.lane, row.measure, row.system, format(row.mean), `${format(row.low)}–${format(row.high)}`, String(row.tasks),
    ]))
    + `\n\n## Dev nDCG@20\n\n`
    + markdownTable(['Lane', 'Measure', 'System', 'Mean', '95% CI', 'Tasks'], devCore.map((row) => [
      row.lane, row.measure, row.system, format(row.mean), `${format(row.low)}–${format(row.high)}`, String(row.tasks),
    ]))
    + `\n\n## Held-out precision@10 and copying rate\n\n`
    + markdownTable(['Lane', 'Measure', 'System', 'Mean', '95% CI'], heldoutPrecision.map((row) => [
      row.lane, row.measure, row.system, format(row.mean), `${format(row.low)}–${format(row.high)}`,
    ]))
    + `\n\n## Pooled recall@100\n\n`
    + markdownTable(['Split', 'Lane', 'Measure', 'System', 'Mean', '95% CI'], coverage.map((row) => [
      row.split, row.lane, row.measure, row.system, format(row.mean), `${format(row.low)}–${format(row.high)}`,
    ]))
    + `\n\n## Retrieval latency\n\n`
    + markdownTable(['System', 'Tasks', 'p50 ms', 'p95 ms'], latencySummary.map((row) => [
      row.system, String(row.tasks), row.p50_ms.toFixed(1), row.p95_ms.toFixed(1),
    ]))
    + `\n\n## Decision\n\n`
    + `- J1 known-channel retrieval stays lexical: held-out MRR is ${format(mean('J1', 'lexical_bm25', 'mrr'))} versus ${format(mean('J1', 'openai_dense', 'mrr'))} dense and ${format(mean('J1', 'rrf_control', 'mrr'))} RRF.\n`
    + `- J2/J3 dense retrieval is useful: held-out J2 nDCG@20 is ${format(mean('J2', 'openai_dense', 'ndcg@20'))}, and J3 dense topic precision@10 is ${format(mean('J3', 'openai_dense', 'topic_precision@10'))}.\n`
    + `- J4 has candidates but does not pass the quality bar: its best held-out precision@10 is RRF at ${format(mean('J4', 'rrf_control', 'precision@10'))}, below 0.600.\n`
    + `- J5 fails the creative-transfer job. Held-out lower-bound creative precision@10 is ${format(mean('J5', 'lexical_bm25', 'lower_precision@10'))} lexical, ${format(mean('J5', 'openai_dense', 'lower_precision@10'))} dense, and ${format(mean('J5', 'rrf_control', 'lower_precision@10'))} RRF; direct-application rates are ${format(mean('J5', 'lexical_bm25', 'direct_application_rate@10'))}, ${format(mean('J5', 'openai_dense', 'direct_application_rate@10'))}, and ${format(mean('J5', 'rrf_control', 'direct_application_rate@10'))}.\n\n`
    + `The selected §8 challenger is dynamic purpose/mechanism extraction and explicit transfer verification for J5, developed only on the original dev tasks. Do not add a global reranker, corpus-wide facets, or endpoints. Freeze a new confirmation set before evaluating the challenger.\n\n`
    + `## Gate status\n\n`
    + `No production-route gate passes on this diagnostic set. Any challenger must be frozen and evaluated on a new confirmation set, and J5 cannot claim a win while unresolved top-10 judgments remain. Brandon's blinded 20-item calibration packet is in \`docs/prd/semantic-eval-v4/brandon-spot-check.json\`.\n`;
  await fs.writeFile(REPORT_PATH, markdown);
  console.log(JSON.stringify({ metrics: metricRows.length, summaries: summary.length, spot_check: spotCheck.length, report: REPORT_PATH }));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(report);
