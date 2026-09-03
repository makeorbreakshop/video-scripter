import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { selectJ5Variant, type J5MetricSet } from '../../lib/semantic/j5-rerank';
import { runMain } from './common';

const DIR = path.resolve('docs/prd/semantic-eval-v4/challenger');
const REPORT = path.resolve('docs/prd/2026-09-03-semantic-j5-challenger.md');

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function mean(rows: J5MetricSet[], key: keyof J5MetricSet): number {
  return rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
}

function percentile(values: number[], probability: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * probability) - 1] ?? 0;
}

async function main(): Promise<void> {
  const [cross, purpose, facets, transfers, baselineCost] = await Promise.all([
    JSON.parse(await fs.readFile(path.join(DIR, 'cross-encoder-dev.json'), 'utf8')),
    JSON.parse(await fs.readFile(path.join(DIR, 'purpose-mechanism-dev.json'), 'utf8')),
    JSON.parse(await fs.readFile(path.join(DIR, 'facets-dev.json'), 'utf8')),
    JSON.parse(await fs.readFile(path.join(DIR, 'transfer-dev.json'), 'utf8')),
    JSON.parse(await fs.readFile(path.join(DIR, '..', 'cost.json'), 'utf8')),
  ]) as Array<{ content_hash: string; body: Record<string, any>; usd?: number; tokens?: number }>;
  const variants = [cross, purpose].map((artifact) => ({
    name: artifact === cross ? 'cross_encoder' : 'purpose_mechanism',
    task_metrics: artifact.body.tasks.map((task: { metrics: J5MetricSet }) => task.metrics),
  }));
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
  const crossTimings = cross.body.tasks.flatMap((task: { timing_ms: number[] }) => task.timing_ms);
  const facetTimings = facets.body.latency_ms as number[];
  const transferTimings = transfers.body.latency_ms as number[];
  const body = {
    scope: 'original J5 dev pools only',
    upstream: { cross_encoder: cross.content_hash, purpose_mechanism: purpose.content_hash,
      facets: facets.content_hash, transfers: transfers.content_hash },
    gate: { lower_creative_precision_at_10_min: 0.3, direct_application_rate_at_10_max: 0.2,
      creative_hit_required_each_task: true, unresolved_top_10_max: 0 },
    summaries,
    latency: {
      cross_encoder_warm_batch_ms: { p50: percentile(crossTimings, 0.5), p95: percentile(crossTimings, 0.95) },
      purpose_mechanism_cold_api_ms: { facet_total: facetTimings.reduce((sum, value) => sum + value, 0),
        transfer_total: transferTimings.reduce((sum, value) => sum + value, 0), calls: facetTimings.length + transferTimings.length },
    },
    purpose_mechanism_cost_upper_bound: purpose.body.cost,
    total_semantic_cost_upper_bound_usd: Number(baselineCost.usd) + purpose.body.cost.usd_upper_bound,
    selected_variant: selected,
    disposition: selected ? 'freeze selected variant and create new confirmation set' : 'stop; no variant qualifies for confirmation',
  };
  const selection = { version: 1, body, content_hash: hash(body) };
  await fs.writeFile(path.join(DIR, 'selection.json'), `${JSON.stringify(selection)}\n`);
  const rows = summaries.map((row) => `| ${row.variant} | ${row.lower_precision_at_10.toFixed(3)} | ${row.upper_precision_at_10.toFixed(3)} | ${row.lower_ndcg_at_20.toFixed(3)} | ${row.direct_application_rate_at_10.toFixed(3)} | ${row.unresolved_top_10} | ${row.creative_hit_on_every_task ? 'yes' : 'no'} | ${row.passes_gate ? 'pass' : 'fail'} |`).join('\n');
  const markdown = `# J5 metadata-only challenger\n\n`
    + `Status: stopped at the dev gate. Neither challenger qualifies for a new confirmation set. No held-out or confirmation tasks were run.\n\n`
    + `## Result\n\n`
    + `| Variant | Lower P@10 | Upper P@10 | Lower nDCG@20 | Direct application@10 | Unresolved top 10 | Hit both tasks | Gate |\n`
    + `| --- | --- | --- | --- | --- | --- | --- | --- |\n${rows}\n\n`
    + `The gate required lower-bound creative precision@10 >= 0.300, direct-application rate <= 0.200, at least one creative hit on each dev task, and zero unresolved top-10 items.\n\n`
    + `The local cross-encoder improved ordering for Make or Break Shop but returned no creative hit in the tech task and mostly copied the source niche. The purpose/mechanism verifier found a creative hit in both tasks, but mean creative precision was only 0.200, direct application remained 0.750, and one unresolved item entered the top 10.\n\n`
    + `## Cost and timing\n\n`
    + `- Cross-encoder: pinned local MS-MARCO MiniLM-L6-v2 on Apple MPS; warm full-pool batch p50 ${body.latency.cross_encoder_warm_batch_ms.p50.toFixed(1)} ms, p95 ${body.latency.cross_encoder_warm_batch_ms.p95.toFixed(1)} ms.\n`
    + `- Purpose/mechanism: ${purpose.body.cost.input_tokens.toLocaleString('en-US')} input and ${purpose.body.cost.output_tokens.toLocaleString('en-US')} output tokens; cost upper bound $${purpose.body.cost.usd_upper_bound.toFixed(6)}, including $${purpose.body.cost.prior_failed_call_usd_upper_bound.toFixed(4)} reserved for five rejected malformed calls.\n`
    + `- Total semantic work through this stop: at most $${body.total_semantic_cost_upper_bound_usd.toFixed(6)} ($${Number(baselineCost.usd).toFixed(6)} frozen prior ledger plus this challenger).\n`
    + `- The API timing is a cold offline batch total across ${body.latency.purpose_mechanism_cold_api_ms.calls} calls, not endpoint latency. Cached frozen facets/rankings require no model call.\n\n`
    + `## Decision\n\n`
    + `There is no J5 challenger to promote. Stop before a confirmation set, corpus-wide facet extraction, endpoint work, or deployment. The metadata-only candidate pool contains useful creative ideas, but neither generic relevance nor the first purpose/mechanism prompt separates them from direct copying reliably enough.\n\n`
    + `The original v1 §10 experiment A (video document recipe) and D (query strategy) still have no valid winner: revision 4 deliberately reset the invalid provisional eval and did not authorize those bake-offs. This J5 test must not be relabeled as an A/D win.\n`;
  await fs.writeFile(REPORT, markdown);
  console.log(JSON.stringify({ report: REPORT, selection: selected, summaries }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(main);
