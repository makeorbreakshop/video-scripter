import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
  bootstrapMeanInterval,
  isValidOutlierEvidence,
  ndcgAtK,
  pooledRecallAtK,
  precisionAtK,
  type FrozenV4TaskManifest,
  type FrozenV4CorpusManifest,
  type OutlierEvidenceRow,
  type V4Lane,
} from '../../lib/semantic/eval-v4';
import type { ResolvedV4Judgment, V4JudgmentOutput } from '../../lib/semantic/judgments-v4';
import { runMain } from './common';

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

interface QueryVectorArtifact {
  preparation_latency_ms: number;
  entries: Array<{ task_id: string }>;
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
  const [tasks, videoCorpus, outlierEvidence, candidates, queryVectors, resolved, blind, provenance, poolStats, documents, resources, frozenCost] = await Promise.all([
    readJson<FrozenV4TaskManifest>('tasks.json'),
    readJson<FrozenV4CorpusManifest>('video-corpus.json'),
    readJson<OutlierEvidenceRow[]>('video-corpus-evidence.json'),
    readJson<CandidateArtifact>('candidate-runs.json'),
    readJson<QueryVectorArtifact>('query-vectors.json'),
    readJson<ResolvedArtifact>('resolved-judgments.json'),
    readJson<BlindArtifact>('blind-pools-pass-1.json'),
    readJson<ProvenanceArtifact>('blind-provenance.json'),
    readJson<{ tasks: Array<{ task_id: string; pool_size: number; overlap_all_three: number }> }>('blind-pool-stats.json'),
    readJson<Record<string, unknown>>('documents.json'),
    readJson<{
      qdrant_image: string;
      qdrant_memory_observed_mib: { before_snapshot: number; after_snapshot: number };
      persistent_volume_all_semantic_experiments: string;
      durable_eval_snapshot_directory: string;
      snapshots: Array<{ collection: string; name: string; bytes: number; sha256: string }>;
      note: string;
    }>('resources.json'),
    readJson<{ captured_at_et: string; tokens: number; usd: number; scope: string }>('cost.json'),
  ]);
  if (candidates.run_id !== resolved.candidate_run_id || candidates.rankings_hash !== resolved.candidate_rankings_hash) {
    throw new Error('resolved judgments do not match candidate run');
  }
  const taskById = new Map(tasks.tasks.map((task) => [task.id, task]));
  const videoCorpusIds = new Set(videoCorpus.ids);
  const outlierEvidenceById = new Map(outlierEvidence.map((row) => [row.id, row]));
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
      metricRows.push({ ...base, measure: 'zero_result', value: ids.length ? 0 : 1 });
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
        const invalid = ids.slice(0, 10).filter((id) => {
          const evidence = outlierEvidenceById.get(id);
          return !videoCorpusIds.has(id) || !evidence || !isValidOutlierEvidence(evidence, tasks.as_of);
        }).length;
        metricRows.push({ ...base, measure: 'invalid_outlier_rate@10', value: invalid / 10 });
      } else {
        const lower = judgmentMap(judgmentRows, (row) => row.resolved === 'creative_adaptation' ? 1 : 0);
        const upper = judgmentMap(judgmentRows, (row) => row.resolved === 'creative_adaptation' || row.resolved === 'unresolved' ? 1 : 0);
        addRankingMetrics(metricRows, base, ids, lower, 'lower_');
        addRankingMetrics(metricRows, base, ids, upper, 'upper_');
        const direct = ids.slice(0, 10).filter((id) => judgmentRows.find((row) => row.entity_id === id)?.resolved === 'direct_application').length / 10;
        metricRows.push({ ...base, measure: 'direct_application_rate@10', value: direct });
      }
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
  const novelCandidateRows = candidates.tasks.flatMap((task) => task.systems.map((system) => {
    const otherIds = new Set(task.systems.filter((other) => other.system !== system.system)
      .flatMap((other) => other.candidates.map((candidate) => candidate.entity_id)));
    const novel = system.candidates.filter((candidate) => !otherIds.has(candidate.entity_id)).length;
    return {
      task_id: task.task_id,
      system: system.system,
      novel,
      returned: system.candidates.length,
    };
  }));
  const novelCandidateSummary = [...new Set(novelCandidateRows.map((row) => row.system))].map((system) => {
    const rows = novelCandidateRows.filter((row) => row.system === system);
    const novel = rows.reduce((sum, row) => sum + row.novel, 0);
    const returned = rows.reduce((sum, row) => sum + row.returned, 0);
    return { system, tasks: rows.length, novel, returned, mean_novel_per_task: novel / rows.length, novel_share: novel / returned };
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
    const boundary = row.lane === 'J5' || row.resolved === 'background' || row.resolved === 'direct_application'
      || row.resolved === 1
      || (typeof row.resolved === 'object' && Object.values(row.resolved).some((value) => value === 1));
    let priority = 99;
    let category = 'sample';
    if (row.resolved === 'unresolved' && topTen) [priority, category] = [0, 'unresolved_top10'];
    else if (disagreed && topTen) [priority, category] = [1, 'disagreement_top10'];
    else if (row.resolved === 'unresolved') [priority, category] = [2, 'unresolved'];
    else if (disagreed && boundary) [priority, category] = [3, 'disagreement_boundary'];
    else if (boundary && topTen) [priority, category] = [4, 'decision_boundary_top10'];
    else if (row.lane === 'J5') [priority, category] = [5, 'j5_category_calibration'];
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
  const stableSpotCandidates = spotCandidates.sort((left, right) => left.priority - right.priority
    || createHash('sha256').update(left.blind_id).digest('hex').localeCompare(createHash('sha256').update(right.blind_id).digest('hex')));
  const selected: typeof stableSpotCandidates = [];
  const selectedIds = new Set<string>();
  const addCount = (pool: typeof stableSpotCandidates, count: number, maxPerTask = Number.POSITIVE_INFINITY): void => {
    let added = 0;
    for (const row of pool) {
      if (added >= count || selected.length >= 20) break;
      if (selectedIds.has(row.blind_id)) continue;
      if (selected.filter((item) => item.task_id === row.task_id).length >= maxPerTask) continue;
      selected.push(row);
      selectedIds.add(row.blind_id);
      added += 1;
    }
  };
  const j5Candidates = stableSpotCandidates.filter((row) => row.task_id.startsWith('j5-'));
  addCount(stableSpotCandidates.filter((row) => row.category === 'unresolved_top10'), 20);
  addCount(j5Candidates.filter((row) => row.resolved === 'creative_adaptation'), 3, 3);
  addCount(j5Candidates.filter((row) => row.resolved === 'direct_application'), 3, 3);
  addCount(j5Candidates.filter((row) => row.resolved === 'background'), 2, 4);
  addCount(j5Candidates.filter((row) => row.resolved === 'unresolved'), 2, 3);
  addCount(stableSpotCandidates.filter((row) => row.category === 'disagreement_top10'), 20 - selected.length, 3);
  addCount(stableSpotCandidates, 20 - selected.length, 4);
  const spotCheck = selected.map(({ priority: _priority, ...row }) => row);
  if (spotCheck.length < 15) throw new Error(`spot-check packet too small: ${spotCheck.length}`);
  for (const category of ['creative_adaptation', 'direct_application', 'background', 'unresolved']) {
    if (spotCheck.filter((row) => row.task_id.startsWith('j5-') && row.resolved === category).length < 2) {
      throw new Error(`spot-check packet needs at least two J5 ${category} examples`);
    }
  }

  const totalCost = { tokens: frozenCost.tokens, usd: frozenCost.usd };
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
    pool_stats: { tasks: poolStats.tasks, novel_candidate_coverage: novelCandidateSummary },
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
  const guardMetrics = summary.filter((row) => row.measure === 'zero_result'
    || (row.lane === 'J4' && row.measure === 'invalid_outlier_rate@10'));
  const heldoutPrecision = summary.filter((row) => row.split === 'heldout'
    && (row.measure.includes('precision@10') || row.measure === 'direct_application_rate@10'));
  const j1 = metricRows.filter((row) => row.lane === 'J1' && row.measure === 'mrr');
  const mean = (lane: V4Lane, system: string, measure: string) => summary.find((row) => (
    row.split === 'heldout' && row.lane === lane && row.system === system && row.measure === measure
  ))?.mean ?? 0;
  const j5DevRankEvidence = candidates.tasks.filter((task) => task.lane === 'J5' && task.split === 'dev').map((task) => {
    const creative = new Set((resolvedByTask.get(task.task_id) ?? [])
      .filter((row) => row.resolved === 'creative_adaptation').map((row) => row.entity_id));
    return {
      task_id: task.task_id,
      systems: task.systems.map((system) => {
        const ranks = system.candidates.filter((candidate) => creative.has(candidate.entity_id)).map((candidate) => candidate.rank);
        return { system: system.system, count: ranks.length, first_rank: ranks[0] ?? null };
      }),
    };
  });
  const markdown = `# Semantic retrieval v4 evaluation\n\n`
    + `Status: generated from frozen revision-4 artifacts. This is a diagnostic evaluation, not a production-route approval. Confidence intervals are descriptive because each lane has only one or two tasks per split.\n\n`
    + `## Corpus and judging\n\n`
    + `- Video corpus: ${documents.videos} guarded one-year outliers.\n`
    + `- Channel corpus: ${documents.channels} channels.\n`
    + `- Pooled non-J1 judgments: ${resolved.judgments.length}; initial agreement ${format(metricsArtifact.judgments.initial_agreement_rate)}; adjudicated ${resolved.adjudicated}; unresolved ${resolved.unresolved}.\n`
    + `- Semantic cost ledger today: $${totalCost.usd.toFixed(6)} for ${totalCost.tokens.toLocaleString('en-US')} tokens, including earlier revision-4 retries/experiments today.\n\n`
    + `## Pool depth and overlap\n\n`
    + markdownTable(['Task', 'Pool size', 'In all three systems'], poolStats.tasks.map((row) => [
      row.task_id, String(row.pool_size), String(row.overlap_all_three),
    ]))
    + `\n\nPools contain 101–194 unique candidates per task; pooled recall below is relative to this judged union, not exhaustive corpus truth.\n\n`
    + `### Per-system novel candidates\n\n`
    + markdownTable(['System', 'Tasks', 'Novel total', 'Mean novel/task', 'Share of returned slots'], novelCandidateSummary.map((row) => [
      row.system, String(row.tasks), String(row.novel), row.mean_novel_per_task.toFixed(1), format(row.novel_share),
    ]))
    + `\n\n`
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
    + `\n\n## Retrieval guardrails\n\n`
    + markdownTable(['Split', 'Lane', 'Measure', 'System', 'Mean'], guardMetrics.map((row) => [
      row.split, row.lane, row.measure, row.system, format(row.mean),
    ]))
    + `\n\nJ4 invalid-outlier rate is recomputed from frozen corpus membership and frozen score evidence; it is not inferred from judge labels.\n\n`
    + `## Measured retrieval components\n\n`
    + markdownTable(['Component', 'Tasks', 'p50 ms', 'p95 ms'], latencySummary.map((row) => [
      row.system, String(row.tasks), row.p50_ms.toFixed(1), row.p95_ms.toFixed(1),
    ]))
    + `\n\nThese are component timings, not comparable end-to-end request latency: OpenAI dense is Qdrant vector-search-only; its frozen query embeddings were prepared in one ${queryVectors.entries.length}-query batch taking ${queryVectors.preparation_latency_ms.toFixed(1)} ms. RRF is fusion-only and excludes both prerequisite retrieval legs.\n\n`
    + `## Local resources and snapshots\n\n`
    + `- Qdrant image: \`${resources.qdrant_image}\`; observed container memory ${resources.qdrant_memory_observed_mib.after_snapshot.toFixed(1)}–${resources.qdrant_memory_observed_mib.before_snapshot.toFixed(1)} MiB.\n`
    + `- Eval snapshots: ${resources.snapshots.map((snapshot) => `${snapshot.collection} ${(snapshot.bytes / 1024 / 1024).toFixed(1)} MiB, SHA-256 \`${snapshot.sha256}\``).join('; ')}.\n`
    + `- Durable snapshot directory: \`${resources.durable_eval_snapshot_directory}\`.\n`
    + `- Persistent volume across all semantic experiments: ${resources.persistent_volume_all_semantic_experiments}. ${resources.note}\n`
    + `\n\n## Decision\n\n`
    + `- J1 known-channel retrieval stays lexical: held-out MRR is ${format(mean('J1', 'lexical_bm25', 'mrr'))} versus ${format(mean('J1', 'openai_dense', 'mrr'))} dense and ${format(mean('J1', 'rrf_control', 'mrr'))} RRF.\n`
    + `- J2/J3 dense retrieval is useful: held-out J2 nDCG@20 is ${format(mean('J2', 'openai_dense', 'ndcg@20'))}, and J3 dense topic precision@10 is ${format(mean('J3', 'openai_dense', 'topic_precision@10'))}.\n`
    + `- J4 has candidates but does not pass the quality bar: its best held-out precision@10 is RRF at ${format(mean('J4', 'rrf_control', 'precision@10'))}, below 0.600.\n`
    + `- J5 fails the creative-transfer job. Held-out lower-bound creative precision@10 is ${format(mean('J5', 'lexical_bm25', 'lower_precision@10'))} lexical, ${format(mean('J5', 'openai_dense', 'lower_precision@10'))} dense, and ${format(mean('J5', 'rrf_control', 'lower_precision@10'))} RRF; direct-application rates are ${format(mean('J5', 'lexical_bm25', 'direct_application_rate@10'))}, ${format(mean('J5', 'openai_dense', 'direct_application_rate@10'))}, and ${format(mean('J5', 'rrf_control', 'direct_application_rate@10'))}.\n\n`
    + `On the two J5 dev tasks, judged creative candidates already exist below rank 20: ${j5DevRankEvidence.map((task) => `${task.task_id}: ${task.systems.map((system) => `${system.system} ${system.count} (first ${system.first_rank ?? 'none'})`).join(', ')}`).join('; ')}. This triggers both §8.2 (ordering failure) and §8.3 (topical results are not transferable); the old report was too confident in selecting §8.3 alone.\n\n`
    + `The next bounded experiment is therefore one J5-local reranking bake-off on the original dev pools: (A) a simple local cross-encoder control and (B) dynamic purpose/mechanism extraction with explicit transfer verification. Select one variant on dev, freeze it, then evaluate that single selected variant on a new confirmation set. Do not add a corpus-wide reranker, precompute corpus-wide facets, or expose endpoints.\n\n`
    + `## Gate status\n\n`
    + `No production-route gate passes on this diagnostic set. Any challenger must be frozen and evaluated on a new confirmation set, and J5 cannot claim a win while unresolved top-10 judgments remain. Brandon's blinded 20-item calibration packet is in \`docs/prd/semantic-eval-v4/brandon-spot-check.json\`.\n`;
  await fs.writeFile(REPORT_PATH, markdown);
  console.log(JSON.stringify({ metrics: metricRows.length, summaries: summary.length, spot_check: spotCheck.length, report: REPORT_PATH }));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(report);
