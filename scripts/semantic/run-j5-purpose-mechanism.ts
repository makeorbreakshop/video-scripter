import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import {
  j5Metrics,
  rankJ5Scores,
  transferRankScore,
  validateJ5Facet,
  validateTransferDecision,
  type J5Facet,
  type J5ResolvedLabel,
  type TransferDecision,
} from '../../lib/semantic/j5-rerank';
import { runMain } from './common';

const EVAL_DIR = path.resolve('docs/prd/semantic-eval-v4');
const DIR = path.join(EVAL_DIR, 'challenger');
const MODEL = 'gpt-5-nano';
const MODEL_VERSION = 'gpt-5-nano-2026-09-03-api-alias';
const PROMPT_VERSION = 'j5-purpose-mechanism-dev-v1';
const MAX_USD = 0.50;
const INPUT_USD_PER_M = 0.05;
const OUTPUT_USD_PER_M = 0.40;
const BATCH_SIZE = 10;
const PRIOR_FAILED_CALL_COST_UPPER_BOUND_USD = 0.0105;

const FACET_SYSTEM = [
  'Extract packaging evidence only from the supplied channel/title/description text.',
  'Purpose is the viewer outcome or job; mechanism is the narrative or format device delivering it.',
  'Abstract away niche nouns, brands, products, and named entities.',
  'Do not infer actual content, quality, popularity, performance, or factual truth.',
  'Use low confidence when evidence is weak. evidence_status must be packaging_only.',
  'Return exactly one result for every supplied entity_id. Copy every entity_id and entity_kind exactly; never omit, add, or rewrite an ID.',
].join(' ');

const TRANSFER_SYSTEM = [
  'Judge whether each candidate packaging idea can transfer to the target channel.',
  'Creative adaptation requires preserving an abstract purpose and mechanism while changing the source niche, object, and problem.',
  'Same- or adjacent-niche ideas are direct_application, not creative transfer.',
  'Generic resemblance without one specific adapted target-channel concept is background.',
  'Judge packaging evidence only. Ignore popularity, performance, and factual truth.',
  'creative_adaptation requires domain_relation=unrelated, all four fit ratings >=2, and non-empty preserved purpose, preserved mechanism, changed surface, and adapted concept.',
].join(' ');

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function batches<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(EVAL_DIR, file), 'utf8')) as T;
}

async function writeFrozen(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value)}\n`, { flag: 'wx' });
}

function facetSchema(entityIds: string[]) {
  const nullable = { type: ['string', 'null'] };
  const item = { type: 'object', properties: {
    niche: nullable, purpose_observed: nullable, purpose_abstract: { type: 'string' },
    mechanism_observed: nullable, mechanism_abstract: { type: 'string' },
    evidence_status: { type: 'string', enum: ['packaging_only'] }, confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  }, required: ['niche', 'purpose_observed', 'purpose_abstract', 'mechanism_observed',
    'mechanism_abstract', 'evidence_status', 'confidence'], additionalProperties: false };
  return { type: 'object', properties: { facets: { type: 'object',
    properties: Object.fromEntries(entityIds.map((id) => [id, item])), required: entityIds, additionalProperties: false } },
  required: ['facets'], additionalProperties: false };
}

function transferSchema(candidateIds: string[]) {
  const nullable = { type: ['string', 'null'] };
  const rating = { type: 'integer', enum: [0, 1, 2, 3] };
  const item = { type: 'object', properties: {
    domain_relation: { type: 'string', enum: ['same', 'adjacent', 'unrelated', 'unknown'] },
    preserved_purpose: nullable, preserved_mechanism: nullable, changed_surface: nullable, adapted_concept: nullable,
    purpose_fit: rating, mechanism_fit: rating, audience_fit: rating, mapping_specificity: rating,
    verdict: { type: 'string', enum: ['creative_adaptation', 'direct_application', 'background', 'none'] },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    blocking_reasons: { type: 'array', items: { type: 'string' } },
  }, required: ['domain_relation', 'preserved_purpose', 'preserved_mechanism', 'changed_surface',
    'adapted_concept', 'purpose_fit', 'mechanism_fit', 'audience_fit', 'mapping_specificity', 'verdict', 'confidence',
    'blocking_reasons'], additionalProperties: false };
  return { type: 'object', properties: { decisions: { type: 'object',
    properties: Object.fromEntries(candidateIds.map((id) => [id, item])), required: candidateIds, additionalProperties: false } },
  required: ['decisions'], additionalProperties: false };
}

function cost(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined) {
  const input = usage?.prompt_tokens ?? 0;
  const output = usage?.completion_tokens ?? 0;
  return { input_tokens: input, output_tokens: output,
    usd: (input * INPUT_USD_PER_M + output * OUTPUT_USD_PER_M) / 1_000_000 };
}

async function main(): Promise<void> {
  if (!process.argv.includes('--execute')) {
    console.log(JSON.stringify({ mode: 'dry-run', model: MODEL, max_usd: MAX_USD, input: path.join(DIR, 'dev-inputs.json') }, null, 2));
    return;
  }
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
  const [input, judgments, candidateRuns] = await Promise.all([
    JSON.parse(await fs.readFile(path.join(DIR, 'dev-inputs.json'), 'utf8')) as {
      split: 'dev'; content_hash: string; body: { candidate_rankings_hash: string; tasks: Array<{ task_id: string;
        seed_channel_id: string; seed_document: string; seed_document_hash: string;
        candidates: Array<{ entity_id: string; document: string; document_hash: string }> }> };
    },
    readJson<{ candidate_rankings_hash: string; judgments: Array<{ task_id: string; entity_id: string; resolved: J5ResolvedLabel }> }>('resolved-judgments.json'),
    readJson<{ rankings_hash: string; tasks: Array<{ task_id: string; systems: Array<{ system: string; candidates: Array<{ entity_id: string; rank: number }> }> }> }>('candidate-runs.json'),
  ]);
  const taskIds = input.body.tasks.map((task) => task.task_id).sort();
  if (input.split !== 'dev' || hash(input.body) !== input.content_hash
    || canonical(taskIds) !== canonical(['j5-maker-transfer', 'j5-tech-transfer'])
    || input.body.candidate_rankings_hash !== judgments.candidate_rankings_hash
    || input.body.candidate_rankings_hash !== candidateRuns.rankings_hash) throw new Error('challenger inputs do not match frozen dev artifacts');

  const configBody = { model: MODEL, model_version: MODEL_VERSION, prompt_version: PROMPT_VERSION, batch_size: BATCH_SIZE,
    max_usd: MAX_USD, facet_system_hash: hash(FACET_SYSTEM), transfer_system_hash: hash(TRANSFER_SYSTEM),
    facet_schema_hash: hash(facetSchema(['<entity_id>'])), transfer_schema_hash: hash(transferSchema(['<candidate_id>'])), ranking_recipe: 'j5-transfer-bucket-v1' };
  await writeFrozen(path.join(DIR, 'variant-configs.json'), { version: 1, body: configBody, content_hash: hash(configBody) });
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let spent = PRIOR_FAILED_CALL_COST_UPPER_BOUND_USD;
  let inputTokens = 0;
  let outputTokens = 0;
  const call = async <T>(system: string, payload: unknown, schemaName: string, schema: Record<string, unknown>, maxTokens: number): Promise<T> => {
    const serialized = JSON.stringify(payload);
    const reservation = ((Math.ceil((system.length + serialized.length) / 3) * INPUT_USD_PER_M) + maxTokens * OUTPUT_USD_PER_M) / 1_000_000;
    if (spent + reservation > MAX_USD) throw new Error(`request reservation would exceed $${MAX_USD.toFixed(2)} cap`);
    const started = performance.now();
    const response = await client.chat.completions.create({ model: MODEL, reasoning_effort: 'minimal',
      messages: [{ role: 'system', content: system }, { role: 'user', content: serialized }],
      response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
      max_completion_tokens: maxTokens });
    const content = response.choices[0]?.message.content;
    if (!content) throw new Error(`${schemaName}: empty model response`);
    const usage = cost(response.usage);
    spent += usage.usd;
    inputTokens += usage.input_tokens;
    outputTokens += usage.output_tokens;
    return { parsed: JSON.parse(content) as T, latency_ms: performance.now() - started } as T;
  };

  const entities = new Map<string, { entity_id: string; entity_kind: 'target_channel' | 'candidate_video'; text: string; source_hash: string }>();
  for (const task of input.body.tasks) {
    entities.set(task.seed_channel_id, { entity_id: task.seed_channel_id, entity_kind: 'target_channel', text: task.seed_document, source_hash: task.seed_document_hash });
    for (const candidate of task.candidates) entities.set(candidate.entity_id,
      { entity_id: candidate.entity_id, entity_kind: 'candidate_video', text: candidate.document, source_hash: candidate.document_hash });
  }
  const facets: J5Facet[] = [];
  const facetLatencies: number[] = [];
  for (const [index, batch] of batches([...entities.values()], BATCH_SIZE).entries()) {
    let parsed: J5Facet[] | null = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
      try {
        const result = await call<{ facets: Record<string, Omit<J5Facet, 'entity_id' | 'entity_kind'>> } & { parsed: { facets: Record<string, Omit<J5Facet, 'entity_id' | 'entity_kind'>> }; latency_ms: number }>(
          attempt ? `${FACET_SYSTEM} The prior response violated the exact identity contract; repair it.` : FACET_SYSTEM,
          batch, 'j5_facets_dev_v1', facetSchema(batch.map((row) => row.entity_id)), 5_000);
        const kindById = new Map(batch.map((row) => [row.entity_id, row.entity_kind]));
        const checked = Object.entries(result.parsed.facets).map(([entityId, facet]) => validateJ5Facet({
          ...facet, entity_id: entityId, entity_kind: kindById.get(entityId)!,
        }));
        if (checked.length !== batch.length || checked.some((row) => !kindById.has(row.entity_id))) throw new Error(`facet batch ${index}: identity mismatch`);
        parsed = checked;
        facetLatencies.push(result.latency_ms);
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
    facets.push(...parsed!);
    console.log(`facets ${Math.min((index + 1) * BATCH_SIZE, entities.size)}/${entities.size}`);
  }
  const facetBody = { input_content_hash: input.content_hash, config_hash: hash(configBody), model: MODEL_VERSION,
    prompt_version: PROMPT_VERSION, source_hashes: Object.fromEntries([...entities].map(([id, row]) => [id, row.source_hash])),
    latency_ms: facetLatencies, cost: { input_tokens: inputTokens, output_tokens: outputTokens, usd_upper_bound: spent,
      prior_failed_call_usd_upper_bound: PRIOR_FAILED_CALL_COST_UPPER_BOUND_USD }, facets };
  await writeFrozen(path.join(DIR, 'facets-dev.json'), { version: 1, body: facetBody, content_hash: hash(facetBody) });

  const facetById = new Map(facets.map((facet) => [facet.entity_id, facet]));
  const decisions: TransferDecision[] = [];
  const transferLatencies: number[] = [];
  for (const task of input.body.tasks) {
    const seedFacet = facetById.get(task.seed_channel_id);
    if (!seedFacet) throw new Error(`${task.task_id}: seed facet missing`);
    for (const [index, batch] of batches(task.candidates, BATCH_SIZE).entries()) {
      const request = { task_id: task.task_id, target_document: task.seed_document, target_facet: seedFacet,
        candidates: batch.map((candidate) => ({ candidate_id: candidate.entity_id, candidate_document: candidate.document,
          candidate_facet: facetById.get(candidate.entity_id) })) };
      let parsed: TransferDecision[] | null = null;
      for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
        try {
          const result = await call<{ decisions: Record<string, Omit<TransferDecision, 'task_id' | 'candidate_id'>> } & { parsed: { decisions: Record<string, Omit<TransferDecision, 'task_id' | 'candidate_id'>> }; latency_ms: number }>(
            attempt ? `${TRANSFER_SYSTEM} Repair any semantic contract violation from the prior attempt.` : TRANSFER_SYSTEM,
            request, 'j5_transfer_dev_v1', transferSchema(batch.map((row) => row.entity_id)), 6_000);
          const expected = new Set(batch.map((row) => row.entity_id));
          const checked = Object.entries(result.parsed.decisions).map(([candidateId, decision]) => validateTransferDecision({
            ...decision, task_id: task.task_id, candidate_id: candidateId,
          }));
          if (checked.length !== expected.size || checked.some((row) => !expected.delete(row.candidate_id)) || expected.size) throw new Error('transfer identity mismatch');
          parsed = checked;
          transferLatencies.push(result.latency_ms);
        } catch (error) {
          if (attempt === 1) throw error;
        }
      }
      decisions.push(...parsed!);
      console.log(`${task.task_id} transfers ${Math.min((index + 1) * BATCH_SIZE, task.candidates.length)}/${task.candidates.length}`);
    }
  }
  const transferBody = { input_content_hash: input.content_hash, facet_content_hash: hash(facetBody), config_hash: hash(configBody),
    model: MODEL_VERSION, prompt_version: PROMPT_VERSION, latency_ms: transferLatencies,
    cost: { input_tokens: inputTokens, output_tokens: outputTokens, usd_upper_bound: spent,
      prior_failed_call_usd_upper_bound: PRIOR_FAILED_CALL_COST_UPPER_BOUND_USD }, decisions };
  await writeFrozen(path.join(DIR, 'transfer-dev.json'), { version: 1, body: transferBody, content_hash: hash(transferBody) });

  const outputTasks = input.body.tasks.map((task) => {
    const taskDecisions = decisions.filter((row) => row.task_id === task.task_id);
    const sourceTask = candidateRuns.tasks.find((row) => row.task_id === task.task_id)!;
    const sourceRanks = new Map<string, Record<string, number>>();
    for (const system of sourceTask.systems) for (const candidate of system.candidates) {
      sourceRanks.set(candidate.entity_id, { ...(sourceRanks.get(candidate.entity_id) ?? {}), [system.system]: candidate.rank });
    }
    const rankings = rankJ5Scores(taskDecisions.map((decision) => ({ entity_id: decision.candidate_id,
      score: transferRankScore(decision), verdict: decision.verdict, source_ranks: sourceRanks.get(decision.candidate_id) ?? {} })));
    const labels = Object.fromEntries(judgments.judgments.filter((row) => row.task_id === task.task_id).map((row) => [row.entity_id, row.resolved]));
    return { task_id: task.task_id, candidate_count: rankings.length, rankings,
      metrics: j5Metrics(rankings.map((row) => row.entity_id), labels) };
  });
  const outputBody = { input_content_hash: input.content_hash, facet_content_hash: hash(facetBody), transfer_content_hash: hash(transferBody),
    config_hash: hash(configBody), model: MODEL_VERSION, prompt_version: PROMPT_VERSION,
    cost: { input_tokens: inputTokens, output_tokens: outputTokens, usd_upper_bound: spent,
      prior_failed_call_usd_upper_bound: PRIOR_FAILED_CALL_COST_UPPER_BOUND_USD }, tasks: outputTasks };
  await writeFrozen(path.join(DIR, 'purpose-mechanism-dev.json'), { version: 1, split: 'dev', variant: 'purpose_mechanism',
    body: outputBody, content_hash: hash(outputBody) });
  console.log(JSON.stringify({ cost: outputBody.cost, tasks: outputTasks.map((task) => ({ task_id: task.task_id, metrics: task.metrics })) }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(main);
