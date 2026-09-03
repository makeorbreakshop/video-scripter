import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { candidateRankingsHash, validateV4TaskManifest, type FrozenV4TaskManifest } from '../../lib/semantic/eval-v4';
import {
  createJ5HashedEnvelope,
  j5Metrics,
  validateJ5HashedEnvelope,
  type J5MetricSet,
  type J5ResolvedLabel,
} from '../../lib/semantic/j5-rerank';
import {
  PACKAGING_TRANSFER_CONFIG,
  PACKAGING_TRANSFER_RECIPE,
  PACKAGING_TRANSFER_VARIANTS,
  packagingTransferGate,
  rankPackagingTransfer,
  type PackagingTransferCandidate,
  type PackagingTransferRanking,
  type PackagingTransferVariant,
} from '../../lib/semantic/packaging-transfer';
import { runMain } from './common';

const EVAL_DIR = path.resolve('docs/prd/semantic-eval-v4');
const DIR = path.join(EVAL_DIR, 'programmatic');
const REPORT_PATH = path.resolve('docs/prd/2026-09-03-semantic-programmatic.md');
const SELECTION_PATH = path.join(DIR, 'selection.json');
const PRIMARY: PackagingTransferVariant = 'cross_topic_diverse';

interface StoredCandidate extends PackagingTransferCandidate {
  blind_id: string;
  channel_name: string;
  judge_input_hash: string;
  blind_document_hash: string;
  vector_document_hash: string;
  vector_hash: string;
  source_channel_vector_hash: string | null;
  confidence: string;
}

interface InputBody {
  source_hashes: Record<string, string>;
  corpus_proof_count: number;
  unique_candidate_count: number;
  candidate_task_pair_count: number;
  source_channel_vector_coverage: { found: number; requested: number };
  thumbnail_overlap: { found: number; requested: number };
  blind_vector_document_mismatch_count: number;
  tasks: Array<{
    task_id: string;
    target_channel_name: string;
    target_titles: string[];
    candidates: StoredCandidate[];
  }>;
}

interface RankingBody {
  input_content_hash: string;
  config_content_hash: string;
  tasks: Array<{
    task_id: string;
    variants: Record<PackagingTransferVariant, PackagingTransferRanking[]>;
  }>;
}

interface ResolvedJudgments {
  candidate_rankings_hash: string;
  judgments: Array<{ task_id: string; entity_id: string; resolved: J5ResolvedLabel }>;
}

interface VariantSummary extends J5MetricSet {
  task_id: string;
  target_channel: string;
  variant: PackagingTransferVariant;
  unique_channels_at_10: number;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function jsonHashWithoutContent(value: Record<string, unknown>): string {
  const { content_hash: _ignored, ...body } = value;
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

function equal(name: string, left: unknown, right: unknown): void {
  if (canonical(left) !== canonical(right)) throw new Error(`${name}: replay mismatch`);
}

function fmt(value: number): string {
  return value.toFixed(3);
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

async function main(): Promise<void> {
  const [inputEnvelope, configEnvelope, rankingsEnvelope, judgments, evidence, taskManifest, blindPools,
    devInputs, candidateRuns, queryVectors, documents, thumbnailCohort, replay, priorSelection] = await Promise.all([
    readJson<{ content_hash: string; body: InputBody }>(path.join(DIR, 'dev-inputs.json')),
    readJson<{ content_hash: string; body: Record<string, unknown> }>(path.join(DIR, 'ranking-config.json')),
    readJson<{ content_hash: string; body: RankingBody }>(path.join(DIR, 'rankings-dev.json')),
    readJson<ResolvedJudgments>(path.join(EVAL_DIR, 'resolved-judgments.json')),
    readJson<Array<{ score: number; n_baseline: number }>>(path.join(EVAL_DIR, 'video-corpus-evidence.json')),
    readJson<FrozenV4TaskManifest>(path.join(EVAL_DIR, 'tasks.json')),
    readJson<unknown>(path.join(EVAL_DIR, 'blind-pools-pass-1.json')),
    readJson<{ content_hash: string; body: unknown }>(path.join(EVAL_DIR, 'challenger/dev-inputs.json')),
    readJson<{ rankings_hash: string; tasks: Array<{ task_id: string; systems: Array<{ system: string;
      candidates: Array<{ entity_id: string; rank: number }> }> }> }>(path.join(EVAL_DIR, 'candidate-runs.json')),
    readJson<Record<string, unknown> & { content_hash: string }>(path.join(EVAL_DIR, 'query-vectors.json')),
    readJson<Record<string, unknown>>(path.join(EVAL_DIR, 'documents.json')),
    readJson<unknown>(path.resolve('docs/prd/semantic-thumbnail-cohort.json')),
    readJson<{ content_hash: string; body: { elapsed_ms: number; input_content_hash: string; config_content_hash: string;
      rankings_content_hash: string } }>(path.join(DIR, 'replay.json')),
    readJson<{ content_hash: string; body: { total_semantic_cost_upper_bound_usd: number } }>(
      path.join(EVAL_DIR, 'challenger/selection.json')),
  ]);

  const input = validateJ5HashedEnvelope(inputEnvelope);
  const config = validateJ5HashedEnvelope(configEnvelope);
  const rankings = validateJ5HashedEnvelope(rankingsEnvelope);
  const replayBody = validateJ5HashedEnvelope(replay);
  validateJ5HashedEnvelope(devInputs);
  validateJ5HashedEnvelope(priorSelection);
  if (jsonHashWithoutContent(queryVectors) !== queryVectors.content_hash) {
    throw new Error('query-vector content hash mismatch');
  }
  validateV4TaskManifest(taskManifest);
  if (candidateRankingsHash(candidateRuns.tasks.flatMap((task) => task.systems.map((system) => ({
    task_id: task.task_id, system: system.system, candidates: system.candidates,
  })))) !== candidateRuns.rankings_hash) throw new Error('candidate rankings source hash mismatch');
  const currentSourceHashes = {
    task_manifest: taskManifest.content_hash,
    blind_pool_pass_1: hash(blindPools),
    exact_blind_inputs: devInputs.content_hash,
    candidate_rankings: candidateRuns.rankings_hash,
    query_vectors: queryVectors.content_hash,
    video_corpus_evidence: hash(evidence),
    documents_manifest: hash(documents),
    thumbnail_cohort: hash(thumbnailCohort),
  };
  equal('input source hashes', input.source_hashes, currentSourceHashes);
  if (judgments.candidate_rankings_hash !== candidateRuns.rankings_hash) throw new Error('resolved judgments source mismatch');
  const expectedConfig = {
    version: 1,
    recipe: PACKAGING_TRANSFER_RECIPE,
    variants: PACKAGING_TRANSFER_VARIANTS,
    sole_eligible_primary: PRIMARY,
    config: PACKAGING_TRANSFER_CONFIG,
    gate: { per_task: { lower_precision_at_10_min: 0.3, direct_application_rate_at_10_max: 0.2,
      creative_hits_at_10_min: 1, unresolved_at_10_max: 0, unique_channels_at_10_min: 8 } },
  };
  equal('ranking config', config, expectedConfig);
  if (rankings.input_content_hash !== inputEnvelope.content_hash
    || rankings.config_content_hash !== configEnvelope.content_hash
    || replayBody.input_content_hash !== inputEnvelope.content_hash
    || replayBody.config_content_hash !== configEnvelope.content_hash
    || replayBody.rankings_content_hash !== rankingsEnvelope.content_hash) throw new Error('programmatic artifact chain mismatch');

  const proofPopulation = evidence.map((row) => ({ outlier_score: row.score, n_baseline: row.n_baseline }));
  const summaries: VariantSummary[] = [];
  for (const task of input.tasks) {
    const labels = Object.fromEntries(judgments.judgments.filter((row) => row.task_id === task.task_id)
      .map((row) => [row.entity_id, row.resolved]));
    const storedTask = rankings.tasks.find((row) => row.task_id === task.task_id);
    if (!storedTask) throw new Error(`${task.task_id}: rankings missing`);
    for (const variant of PACKAGING_TRANSFER_VARIANTS) {
      const rankingCandidates: PackagingTransferCandidate[] = task.candidates.map((candidate) => ({
        entity_id: candidate.entity_id,
        channel_id: candidate.channel_id,
        title: candidate.title,
        document_affinity: candidate.document_affinity,
        source_document_affinity: candidate.source_document_affinity,
        outlier_score: candidate.outlier_score,
        n_baseline: candidate.n_baseline,
      }));
      const replayed = rankPackagingTransfer(rankingCandidates, task.target_titles, variant, { proof_population: proofPopulation });
      equal(`${task.task_id}/${variant} rankings`, storedTask.variants[variant], replayed);
      const metrics = j5Metrics(replayed.map((row) => row.entity_id), labels);
      const uniqueChannels = new Set(replayed.slice(0, 10).map((row) => row.channel_id)).size;
      summaries.push({ task_id: task.task_id, target_channel: task.target_channel_name, variant, ...metrics,
        unique_channels_at_10: uniqueChannels });
    }
  }
  const primaryRows = summaries.filter((row) => row.variant === PRIMARY);
  const gate = packagingTransferGate(primaryRows, {
    expected_task_ids: input.tasks.map((task) => task.task_id),
  });
  const selected = gate.passed ? PRIMARY : null;
  const totalCost = priorSelection.body.total_semantic_cost_upper_bound_usd;
  const selection = createJ5HashedEnvelope({
    version: 1,
    scope: 'two frozen J5 development pools; exploratory because source-channel feature choice followed a dev-label sanity check',
    upstream: { input: inputEnvelope.content_hash, config: configEnvelope.content_hash,
      rankings: rankingsEnvelope.content_hash, replay: replay.content_hash,
      resolved_judgments: hash(judgments), prior_selection: priorSelection.content_hash },
    primary: PRIMARY,
    selected_variant: selected,
    gate,
    summaries,
    coverage: {
      unique_candidates: input.unique_candidate_count,
      candidate_task_pairs: input.candidate_task_pair_count,
      source_channel_vectors: input.source_channel_vector_coverage,
      thumbnails: input.thumbnail_overlap,
      blind_vector_document_mismatches: input.blind_vector_document_mismatch_count,
    },
    latency_ms: replayBody.elapsed_ms,
    incremental_paid_model_cost_usd: 0,
    total_semantic_cost_upper_bound_usd: totalCost,
    disposition: gate.passed
      ? 'exploratory dev pass; freeze a genuinely unseen confirmation set before any product work'
      : 'stop; deterministic metadata features do not pass the per-task gate',
  });
  await fs.writeFile(SELECTION_PATH, `${JSON.stringify(selection)}\n`);

  const tableRows = summaries.map((row) => `| ${row.target_channel} | \`${row.variant}\` | ${fmt(row.lower_precision_at_k)} | ${fmt(row.upper_precision_at_k)} | ${fmt(row.lower_ndcg_at_20)} | ${fmt(row.upper_ndcg_at_20)} | ${fmt(row.direct_application_rate_at_k)} | ${row.unresolved_at_k} | ${row.creative_hits_at_k} | ${row.unique_channels_at_10} |`);
  const primaryDeltaRows = primaryRows.map((primary) => {
    const baseline = summaries.find((row) => row.task_id === primary.task_id && row.variant === 'title_form')!;
    return `| ${primary.target_channel} | ${fmt(primary.lower_precision_at_k - baseline.lower_precision_at_k)} | ${fmt(primary.lower_ndcg_at_20 - baseline.lower_ndcg_at_20)} | ${fmt(primary.direct_application_rate_at_k - baseline.direct_application_rate_at_k)} |`;
  });
  const markdown = `# Semantic programmatic packaging-transfer experiment\n\nDate: 2026-09-03. Status: ${gate.passed ? 'exploratory pass; unseen confirmation required' : 'failed; stop condition applied'}.\n\n## Outcome\n\nThe sole eligible primary, \`${PRIMARY}\`, **${gate.passed ? 'passed' : 'failed'}** the literal per-task gate. ${gate.passed ? 'Because the source-channel feature was proposed after an independent dev-label sanity check, this is not a clean blind result and cannot authorize product work; a new unseen confirmation set is required.' : 'No variant advances, and the diagnostic ablations cannot rescue it.'}\n\nThis was a fully local, deterministic rerank of ${input.candidate_task_pair_count} task-candidate pairs (${input.unique_candidate_count} unique videos). It made no LLM call, embedding call, database write, or endpoint change. Incremental paid cost was **$0.00**; total semantic spend remains conservatively bounded at **$${totalCost.toFixed(6)}**.\n\n## Results\n\n| Target | Variant | strict P@10 | unresolved→relevant P@10 | strict nDCG@20 | unresolved→relevant nDCG@20 | direct@10 | unresolved@10 | creative@10 | channels@10 |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|\n${tableRows.join('\n')}\n\nThe unresolved→relevant columns are sensitivity calculations, not guaranteed numeric upper bounds for normalized nDCG because the ideal denominator also changes. The primary gate is applied to each task independently: strict P@10 >= 0.300, direct@10 <= 0.200, creative@10 >= 1, unresolved@10 = 0, and channels@10 >= 8. ${gate.failures.length ? `Failures: ${gate.failures.join('; ')}.` : 'Every condition passed.'}\n\n## Ablation delta: primary minus title-form only\n\n| Target | Δ strict P@10 | Δ strict nDCG@20 | Δ direct@10 |\n|---|---:|---:|---:|\n${primaryDeltaRows.join('\n')}\n\n## Coverage and provenance\n\n- Candidate video vectors: ${input.unique_candidate_count}/${input.unique_candidate_count}.\n- Source-channel vectors: ${input.source_channel_vector_coverage.found}/${input.source_channel_vector_coverage.requested}; missing sources fell back to candidate-video affinity exactly as frozen.\n- Thumbnail pilot overlap: ${input.thumbnail_overlap.found}/${input.thumbnail_overlap.requested}; thumbnails were therefore excluded.\n- Exact blind document versus vector-document mismatches: ${input.blind_vector_document_mismatch_count}.\n- End-to-end local replay latency: ${replayBody.elapsed_ms.toFixed(1)} ms.\n- Recipe: 0.60 inverse maximum video/source-channel document-affinity percentile + 0.25 title-form compatibility + 0.15 outlier proof, then deterministic packaging-similarity and source-channel diversification.\n- The ranking/config/input artifacts were frozen before this reporting script loaded resolved judgments. The source-channel feature itself is disclosed as dev-informed, so even a gate pass is exploratory rather than confirmatory.\n\nArtifacts: \`docs/prd/semantic-eval-v4/programmatic/dev-inputs.json\`, \`ranking-config.json\`, \`rankings-dev.json\`, and \`selection.json\`.\n`;
  await fs.writeFile(REPORT_PATH, markdown);
  console.log(JSON.stringify({ report: REPORT_PATH, selected_variant: selected, gate, summaries,
    incremental_cost_usd: 0, total_cost_upper_bound_usd: totalCost }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(main);
