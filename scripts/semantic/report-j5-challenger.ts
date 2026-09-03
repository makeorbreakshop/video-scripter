import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
  candidateRankingsHash,
  validateV4TaskManifest,
  type FrozenV4TaskManifest,
} from '../../lib/semantic/eval-v4';
import {
  j5Metrics,
  rankJ5Scores,
  selectJ5Variant,
  transferRankScore,
  validateTransferDecision,
  type J5MetricSet,
  type J5ResolvedLabel,
  type TransferDecision,
} from '../../lib/semantic/j5-rerank';
import { runMain } from './common';

const EVAL_DIR = path.resolve('docs/prd/semantic-eval-v4');
const DIR = path.join(EVAL_DIR, 'challenger');
const REPORT = path.resolve('docs/prd/2026-09-03-semantic-j5-challenger.md');

interface Artifact<T> { content_hash: string; body: T }
interface RankedTask {
  task_id: string;
  timing_ms?: number[];
  rankings: Array<{ entity_id: string; score: number; rank: number }>;
  metrics: J5MetricSet;
}
interface RunCost {
  input_tokens: number;
  output_tokens: number;
  current_completion_run_usd: number;
  prior_invalidated_run_usd_upper_bound: number;
  prior_invalidated_run_tokens: { input_tokens: number; output_tokens: number };
  interrupted_corrected_run_usd_upper_bound: number;
  usd_upper_bound: number;
}
interface ModelProvenance { requested_model: string; response_models: string[]; system_fingerprints: string[] }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function byteHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertArtifact<T>(name: string, artifact: Artifact<T>): void {
  if (hash(artifact.body) !== artifact.content_hash) throw new Error(`${name}: content hash mismatch`);
}

function assertEqual(name: string, left: unknown, right: unknown): void {
  if (canonical(left) !== canonical(right)) throw new Error(`${name}: derived content mismatch`);
}

function mean(rows: J5MetricSet[], key: keyof J5MetricSet): number {
  return rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
}

function percentile(values: number[], probability: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * probability) - 1] ?? 0;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

async function main(): Promise<void> {
  const [input, rawCross, cross, purpose, facets, transfers, config, rankingConfig, judgments, baselineCost,
    taskManifest, blindPools, judgmentBundle, candidateRuns] = await Promise.all([
    readJson<Artifact<{ task_manifest_hash: string; candidate_rankings_hash: string; blind_pool_pass_1_hash: string;
      judgment_bundle_hash: string; tasks: Array<{ task_id: string }> }>>(path.join(DIR, 'dev-inputs.json')),
    readJson<{ content_hash: string; body_json: string }>(path.join(DIR, 'cross-encoder-raw.json')),
    readJson<Artifact<{ input_content_hash: string; raw_content_hash: string; resolved_judgments_hash: string;
      tasks: RankedTask[] }>>(path.join(DIR, 'cross-encoder-dev.json')),
    readJson<Artifact<{ input_content_hash: string; facet_content_hash: string; transfer_content_hash: string;
      config_hash: string; ranking_config_hash: string; resolved_judgments_hash: string; model_provenance: ModelProvenance;
      cost: RunCost; tasks: RankedTask[] }>>(path.join(DIR, 'purpose-mechanism-dev.json')),
    readJson<Artifact<{ input_content_hash: string; config_hash: string; latency_ms: number[] }>>(path.join(DIR, 'facets-dev.json')),
    readJson<Artifact<{ input_content_hash: string; facet_content_hash: string; config_hash: string;
      latency_ms: number[]; decisions: TransferDecision[];
      repair: { attempted_candidate_count: number; remaining_fallback_count: number } }>>(path.join(DIR, 'transfer-dev.json')),
    readJson<Artifact<Record<string, unknown>>>(path.join(DIR, 'variant-configs.json')),
    readJson<Artifact<Record<string, unknown>>>(path.join(DIR, 'ranking-config.json')),
    readJson<{ candidate_rankings_hash: string; judgments: Array<{ task_id: string; entity_id: string; resolved: J5ResolvedLabel }> }>(path.join(EVAL_DIR, 'resolved-judgments.json')),
    readJson<{ usd: number; tokens: number }>(path.join(EVAL_DIR, 'cost.json')),
    readJson<FrozenV4TaskManifest>(path.join(EVAL_DIR, 'tasks.json')),
    readJson<unknown>(path.join(EVAL_DIR, 'blind-pools-pass-1.json')),
    readJson<unknown>(path.join(EVAL_DIR, 'judgments-pass-1-2.json')),
    readJson<{ rankings_hash: string; tasks: Array<{ task_id: string; systems: Array<{ system: string;
      candidates: Array<{ entity_id: string; rank: number }> }> }> }>(path.join(EVAL_DIR, 'candidate-runs.json')),
  ]);

  for (const [name, artifact] of [['inputs', input], ['cross', cross], ['purpose', purpose], ['facets', facets],
    ['transfers', transfers], ['config', config], ['ranking config', rankingConfig]] as const) assertArtifact(name, artifact);
  validateV4TaskManifest(taskManifest);
  const recomputedCandidateRankingsHash = candidateRankingsHash(candidateRuns.tasks.flatMap((task) => task.systems
    .map((system) => ({ task_id: task.task_id, system: system.system, candidates: system.candidates }))));
  if (recomputedCandidateRankingsHash !== candidateRuns.rankings_hash) throw new Error('candidate-runs rankings hash mismatch');
  if (byteHash(rawCross.body_json) !== rawCross.content_hash) throw new Error('raw cross-encoder byte hash mismatch');
  const resolvedJudgmentsHash = hash(judgments);
  const baselineCostHash = hash(baselineCost);
  const rawBody = JSON.parse(rawCross.body_json) as { input_content_hash: string;
    tasks: Array<{ task_id: string; timing_ms: number[]; scores: Array<{ entity_id: string; score: number }> }> };
  const expectedTaskIds = input.body.tasks.map((task) => task.task_id).sort();
  const taskSets = [rawBody.tasks.map((task) => task.task_id), cross.body.tasks.map((task) => task.task_id),
    purpose.body.tasks.map((task) => task.task_id), [...new Set(transfers.body.decisions.map((row) => row.task_id))]];
  if (canonical(expectedTaskIds) !== canonical(['j5-maker-transfer', 'j5-tech-transfer'])
    || taskSets.some((ids) => canonical([...ids].sort()) !== canonical(expectedTaskIds))) {
    throw new Error('challenger task scope differs from the exact two frozen dev tasks');
  }
  if (input.body.task_manifest_hash !== taskManifest.content_hash
    || input.body.blind_pool_pass_1_hash !== hash(blindPools)
    || input.body.judgment_bundle_hash !== hash(judgmentBundle)
    || input.body.candidate_rankings_hash !== candidateRuns.rankings_hash
    || input.body.candidate_rankings_hash !== judgments.candidate_rankings_hash
    || rawBody.input_content_hash !== input.content_hash
    || cross.body.input_content_hash !== input.content_hash
    || cross.body.raw_content_hash !== rawCross.content_hash
    || cross.body.resolved_judgments_hash !== resolvedJudgmentsHash
    || facets.body.input_content_hash !== input.content_hash
    || facets.body.config_hash !== config.content_hash
    || transfers.body.input_content_hash !== input.content_hash
    || transfers.body.facet_content_hash !== facets.content_hash
    || transfers.body.config_hash !== config.content_hash
    || purpose.body.input_content_hash !== input.content_hash
    || purpose.body.facet_content_hash !== facets.content_hash
    || purpose.body.transfer_content_hash !== transfers.content_hash
    || purpose.body.config_hash !== config.content_hash
    || purpose.body.ranking_config_hash !== rankingConfig.content_hash
    || purpose.body.resolved_judgments_hash !== resolvedJudgmentsHash) throw new Error('challenger artifact provenance chain mismatch');

  const labelsFor = (taskId: string) => Object.fromEntries(judgments.judgments
    .filter((row) => row.task_id === taskId).map((row) => [row.entity_id, row.resolved]));
  const crossMetrics = rawBody.tasks.map((rawTask) => {
    const rankings = rankJ5Scores(rawTask.scores);
    const metrics = j5Metrics(rankings.map((row) => row.entity_id), labelsFor(rawTask.task_id));
    const stored = cross.body.tasks.find((task) => task.task_id === rawTask.task_id);
    if (!stored) throw new Error(`${rawTask.task_id}: stored cross-encoder task missing`);
    assertEqual(`${rawTask.task_id}: cross rankings`, stored.rankings, rankings);
    assertEqual(`${rawTask.task_id}: cross metrics`, stored.metrics, metrics);
    return metrics;
  });
  const purposeMetrics = purpose.body.tasks.map((stored) => {
    const rankings = rankJ5Scores(transfers.body.decisions.filter((row) => row.task_id === stored.task_id)
      .map((raw) => {
        const decision = validateTransferDecision(raw);
        return { entity_id: decision.candidate_id, score: transferRankScore(decision) };
      }));
    const metrics = j5Metrics(rankings.map((row) => row.entity_id), labelsFor(stored.task_id));
    assertEqual(`${stored.task_id}: purpose ranking ids`, stored.rankings.map((row) => row.entity_id), rankings.map((row) => row.entity_id));
    assertEqual(`${stored.task_id}: purpose metrics`, stored.metrics, metrics);
    return metrics;
  });
  const variants = [
    { name: 'cross_encoder', task_metrics: crossMetrics },
    { name: 'purpose_mechanism', task_metrics: purposeMetrics },
  ];
  const selected = selectJ5Variant(variants);
  const summaries = variants.map((variant) => ({
    variant: variant.name,
    lower_precision_at_10: mean(variant.task_metrics, 'lower_precision_at_k'),
    upper_precision_at_10: mean(variant.task_metrics, 'upper_precision_at_k'),
    lower_ndcg_at_20: mean(variant.task_metrics, 'lower_ndcg_at_20'),
    upper_ndcg_at_20: mean(variant.task_metrics, 'upper_ndcg_at_20'),
    direct_application_rate_at_10: mean(variant.task_metrics, 'direct_application_rate_at_k'),
    unresolved_top_10: variant.task_metrics.reduce((sum, metrics) => sum + metrics.unresolved_at_k, 0),
    creative_hit_on_every_task: variant.task_metrics.every((metrics) => metrics.creative_hits_at_k > 0),
    passes_gate: variant.task_metrics.every((metrics) => metrics.unresolved_at_k === 0 && metrics.creative_hits_at_k > 0)
      && mean(variant.task_metrics, 'lower_precision_at_k') >= 0.3
      && mean(variant.task_metrics, 'direct_application_rate_at_k') <= 0.2,
  }));
  const crossTimings = rawBody.tasks.flatMap((task) => task.timing_ms);
  const invalidFallbacks = purpose.body.tasks.map((task) => {
    const ids = new Set(transfers.body.decisions.filter((row) => row.task_id === task.task_id
      && row.blocking_reasons.includes('invalid creative mapping downgraded')).map((row) => row.candidate_id));
    return { task_id: task.task_id, count: ids.size,
      top_20_count: task.rankings.slice(0, 20).filter((row) => ids.has(row.entity_id)).length };
  });
  const body = {
    scope: 'original J5 dev pools only; exact blind title/channel/description fields',
    upstream: { inputs: input.content_hash, cross_encoder: cross.content_hash, purpose_mechanism: purpose.content_hash,
      facets: facets.content_hash, transfers: transfers.content_hash, config: config.content_hash,
      ranking_config: rankingConfig.content_hash,
      task_manifest: taskManifest.content_hash, blind_pool_pass_1: hash(blindPools), judgment_bundle: hash(judgmentBundle),
      candidate_rankings: candidateRuns.rankings_hash, resolved_judgments: resolvedJudgmentsHash,
      baseline_cost: baselineCostHash },
    gate: { lower_creative_precision_at_10_min: 0.3, direct_application_rate_at_10_max: 0.2,
      creative_hit_required_each_task: true, unresolved_top_10_max: 0 },
    summaries,
    latency: {
      cross_encoder_warm_batch_ms: { p50: percentile(crossTimings, 0.5), p95: percentile(crossTimings, 0.95) },
      purpose_mechanism_cold_api_ms: { facet_total: facets.body.latency_ms.reduce((sum, value) => sum + value, 0),
        transfer_total: transfers.body.latency_ms.reduce((sum, value) => sum + value, 0),
        calls: facets.body.latency_ms.length + transfers.body.latency_ms.length },
    },
    purpose_mechanism_model_provenance: purpose.body.model_provenance,
    invalid_creative_output_repair: transfers.body.repair,
    invalid_creative_output_fallbacks: invalidFallbacks,
    purpose_mechanism_cost_upper_bound: purpose.body.cost,
    total_semantic_cost_upper_bound_usd: baselineCost.usd + purpose.body.cost.usd_upper_bound,
    selected_variant: selected,
    disposition: selected ? 'freeze selected variant and create new confirmation set' : 'stop; no variant qualifies for confirmation',
  };
  const selection = { version: 2, body, content_hash: hash(body) };
  await fs.writeFile(path.join(DIR, 'selection.json'), `${JSON.stringify(selection)}\n`);
  const rows = summaries.map((row) => `| ${row.variant} | ${row.lower_precision_at_10.toFixed(3)} | ${row.upper_precision_at_10.toFixed(3)} | ${row.lower_ndcg_at_20.toFixed(3)} | ${row.direct_application_rate_at_10.toFixed(3)} | ${row.unresolved_top_10} | ${row.creative_hit_on_every_task ? 'yes' : 'no'} | ${row.passes_gate ? 'pass' : 'fail'} |`).join('\n');
  const modelNames = purpose.body.model_provenance.response_models.join(', ') || 'not returned';
  const markdown = `# J5 metadata-only challenger\n\n`
    + `Status: stopped at the dev gate. Neither challenger qualifies for a new confirmation set. No held-out or confirmation tasks were run.\n\n`
    + `## Result\n\n`
    + `| Variant | Lower P@10 | Upper P@10 | Lower nDCG@20 | Direct application@10 | Unresolved top 10 | Hit both tasks | Gate |\n`
    + `| --- | --- | --- | --- | --- | --- | --- | --- |\n${rows}\n\n`
    + `The gate required lower-bound creative precision@10 >= 0.300, direct-application rate <= 0.200, at least one creative hit on each dev task, and zero unresolved top-10 items.\n\n`
    + `The challengers used the exact title, channel, and description shown in the blind judgment pools. The target context used only the frozen task intent and channel identity. Artifact hashes, upstream links, rankings, and metrics are revalidated when this report is generated. The original per-judgment hash covers the candidate payload rather than the entire task-and-rubric view; the frozen blind-pool and assignment hashes preserve that surrounding context, but this remains a residual provenance limitation.\n\n`
    + `The primary purpose/mechanism pass emitted ${transfers.body.repair.attempted_candidate_count} internally inconsistent creative labels. The single repair pass produced valid decisions for ${transfers.body.repair.attempted_candidate_count - transfers.body.repair.remaining_fallback_count}; ${transfers.body.repair.remaining_fallback_count} remained invalid and the deterministic safety rule demoted it to the bottom as low-confidence output. ${invalidFallbacks.reduce((sum, row) => sum + row.top_20_count, 0)} fallback results appeared across the two tasks' top 20s.\n\n`
    + `## Cost and timing\n\n`
    + `- Cross-encoder: pinned local MS-MARCO MiniLM-L6-v2 on Apple MPS; warm full-pool batch p50 ${body.latency.cross_encoder_warm_batch_ms.p50.toFixed(1)} ms, p95 ${body.latency.cross_encoder_warm_batch_ms.p95.toFixed(1)} ms.\n`
    + `- Purpose/mechanism: requested ${purpose.body.model_provenance.requested_model}; provider returned ${modelNames}. The completion run used ${purpose.body.cost.input_tokens.toLocaleString('en-US')} input and ${purpose.body.cost.output_tokens.toLocaleString('en-US')} output tokens and cost $${purpose.body.cost.current_completion_run_usd.toFixed(6)}.\n`
    + `- The withdrawn mismatched-input run remains charged at $${purpose.body.cost.prior_invalidated_run_usd_upper_bound.toFixed(6)}. Its ${purpose.body.cost.prior_invalidated_run_tokens.input_tokens.toLocaleString('en-US')} input and ${purpose.body.cost.prior_invalidated_run_tokens.output_tokens.toLocaleString('en-US')} output tokens cover metered accepted and rejected calls; the upper bound also includes an extra conservative allowance for malformed responses.\n`
    + `- The interrupted corrected-input run had unpersisted transfer usage and is conservatively charged the entire remaining original cap: $${purpose.body.cost.interrupted_corrected_run_usd_upper_bound.toFixed(6)}. Challenger spend is therefore at most $${purpose.body.cost.usd_upper_bound.toFixed(6)}.\n`
    + `- Total semantic work through this stop: at most $${body.total_semantic_cost_upper_bound_usd.toFixed(6)} ($${baselineCost.usd.toFixed(6)} frozen prior ledger plus all challenger attempts).\n`
    + `- The API timing is a cold offline batch total across ${body.latency.purpose_mechanism_cold_api_ms.calls} calls, not endpoint latency. Cached frozen facets/rankings require no model call.\n\n`
    + `## Decision\n\n`
    + `There is no J5 challenger to promote. Stop before a confirmation set, corpus-wide facet extraction, endpoint work, or deployment. The metadata-only candidate pool contains useful creative ideas, but neither generic relevance nor the first purpose/mechanism prompt separates them from direct copying reliably enough.\n\n`
    + `The original v1 §10 experiment A (video document recipe) and D (query strategy) still have no valid winner: revision 4 deliberately reset the invalid provisional eval and did not authorize those bake-offs. This J5 test must not be relabeled as an A/D win.\n`;
  await fs.writeFile(REPORT, markdown);
  console.log(JSON.stringify({ report: REPORT, selection: selected, summaries }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(main);
