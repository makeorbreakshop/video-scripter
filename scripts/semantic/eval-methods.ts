import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import { mean, mrr, ndcgAt, percentile, recallAt } from '../../lib/semantic/eval';
import { embedTexts } from '../../lib/semantic/embed';
import { reciprocalRankFuseMany, SemanticQdrant } from '../../lib/semantic/qdrant';
import { chunks, db, runMain, sinceDate } from './common';

const OUTPUT_PATH = path.resolve('docs/prd/semantic-method-results.json');
const CHANNEL_COLLECTION = 'channels_v1';
const VIDEO_VARIANTS = {
  title: 'videos_title_v1',
  default: 'videos_v1',
  description: 'videos_description_v1',
} as const;

interface VideoPayload {
  video_id: string;
  channel_id: string;
  channel_name: string;
  title: string;
  is_outlier: boolean;
}

interface ChannelPayload { channel_id: string; name: string }
interface SearchHit { id: string; payload: ChannelPayload }
interface ExpectedChannel { channel_id: string; name: string; grade: number }
interface GoldQuery {
  id: string;
  stratum: 'known_item' | 'discovery' | 'analogue';
  query: string;
  expected_channels: ExpectedChannel[];
}
interface GoldFile { queries: GoldQuery[] }
interface VideoSeed { id: string; title: string; channel_id: string; channel_name: string }
interface BlindPair {
  id: string;
  variant: keyof typeof VIDEO_VARIANTS;
  source_title: string;
  candidate_title: string;
  candidate_channel: string;
}
interface PairLabel { id: string; topic: number; format_hook: number; transferability: number }
interface QueryExpansion { id: string; literal: string; audience_problem: string; format_hook: string }

function opaqueId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 16);
}

function generationCost(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): number {
  return (usage?.prompt_tokens ?? 0) * 0.25 / 1_000_000
    + (usage?.completion_tokens ?? 0) * 2 / 1_000_000;
}

async function logGenerationCost(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): Promise<number> {
  const tokens = (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);
  const usd = generationCost(usage);
  await db().query(
    `insert into semantic_cost_ledger (date, tokens, usd) values (current_date, $1, $2)`,
    [tokens, usd],
  );
  return usd;
}

async function judgePairs(client: OpenAI, pairs: BlindPair[]): Promise<{ labels: PairLabel[]; costUsd: number }> {
  const blinded = [...pairs]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, source_title, candidate_title, candidate_channel }) => ({ id, source_title, candidate_title, candidate_channel }));
  const labels: PairLabel[] = [];
  let costUsd = 0;
  for (const batch of chunks(blinded, 50)) {
    const expectedIds = new Set(batch.map((pair) => pair.id));
    const completion = await client.chat.completions.create({
      model: 'gpt-5-mini',
      reasoning_effort: 'minimal',
      messages: [
        {
          role: 'system',
          content: 'Blindly grade YouTube-video retrieval pairs. Score topic match, format/hook match, and transferability to another creator from 0 to 2. Judge only the supplied text. Return every id exactly once.',
        },
        { role: 'user', content: JSON.stringify(batch) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'pair_labels',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              labels: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', enum: [...expectedIds] },
                    topic: { type: 'integer', minimum: 0, maximum: 2 },
                    format_hook: { type: 'integer', minimum: 0, maximum: 2 },
                    transferability: { type: 'integer', minimum: 0, maximum: 2 },
                  },
                  required: ['id', 'topic', 'format_hook', 'transferability'],
                  additionalProperties: false,
                },
              },
            },
            required: ['labels'],
            additionalProperties: false,
          },
        },
      },
      max_completion_tokens: 5_000,
    });
    costUsd += await logGenerationCost(completion.usage);
    const content = completion.choices[0]?.message.content;
    if (!content) throw new Error(`Pair judge returned no JSON (${completion.choices[0]?.finish_reason ?? 'unknown finish reason'})`);
    const parsed = JSON.parse(content) as { labels: PairLabel[] };
    if (parsed.labels.length !== batch.length) throw new Error(`Pair judge returned ${parsed.labels.length}/${batch.length} labels`);
    const returnedIds = new Set(parsed.labels.map((label) => label.id));
    if (returnedIds.size !== expectedIds.size || [...expectedIds].some((id) => !returnedIds.has(id))) {
      throw new Error('Pair judge did not return each requested id exactly once');
    }
    labels.push(...parsed.labels);
  }
  return { labels, costUsd };
}

async function evaluateVideoVariants(qdrant: SemanticQdrant, client: OpenAI) {
  const windowStart = sinceDate('30d');
  const [seedResult, baseResult] = await Promise.all([
    db().query<VideoSeed>(
      `select v.id, v.title, v.channel_id, coalesce(v.channel_name, v.channel_id) as channel_name
         from videos v join video_scores s on s.video_id = v.id
        where v.published_at > $1 and coalesce(v.is_short, false) = false and v.duration <> 'P0D'
          and s.score >= 2 and s.confidence in ('likely', 'confirmed')
        order by md5(v.id) limit 200`,
      [windowStart],
    ),
    db().query<{ outliers: string; total: string }>(
      `select count(*) filter (where s.score >= 2 and s.confidence in ('likely', 'confirmed'))::bigint as outliers,
              count(*)::bigint as total
         from videos v left join video_scores s on s.video_id = v.id
        where v.published_at > $1 and coalesce(v.is_short, false) = false and v.duration <> 'P0D'`,
      [windowStart],
    ),
  ]);
  const seeds = seedResult.rows;
  const libraryOutlierRate = Number(baseResult.rows[0].outliers) / Number(baseResult.rows[0].total);
  const pairs: BlindPair[] = [];
  const raw: Record<string, { listUniquePass: boolean[]; outliers: boolean[]; similarities: number[] }> = {};

  for (const [variant, collection] of Object.entries(VIDEO_VARIANTS) as Array<[keyof typeof VIDEO_VARIANTS, string]>) {
    raw[variant] = { listUniquePass: [], outliers: [], similarities: [] };
    for (const [seedIndex, seed] of seeds.entries()) {
      const point = await qdrant.point<VideoPayload>(collection, seed.id);
      const hits = await qdrant.query<VideoPayload>(collection, point.vector, {
        limit: 10,
        filter: { must_not: [{ key: 'channel_id', match: { value: seed.channel_id } }] },
      });
      raw[variant].listUniquePass.push(new Set(hits.map((hit) => hit.payload.channel_id)).size >= 5);
      raw[variant].outliers.push(...hits.map((hit) => hit.payload.is_outlier));
      raw[variant].similarities.push(...hits.map((hit) => hit.score));
      if (seedIndex < 100 && hits[0]) {
        pairs.push({
          id: opaqueId(seed.id, variant, String(hits[0].id)),
          variant,
          source_title: seed.title,
          candidate_title: hits[0].payload.title,
          candidate_channel: hits[0].payload.channel_name,
        });
      }
    }
  }

  if (pairs.length !== Math.min(100, seeds.length) * Object.keys(VIDEO_VARIANTS).length) {
    throw new Error(`Expected ${Math.min(100, seeds.length) * Object.keys(VIDEO_VARIANTS).length} blind pairs, got ${pairs.length}`);
  }
  const judged = await judgePairs(client, pairs);
  const labelById = new Map(judged.labels.map((label) => [label.id, label]));
  const variants = Object.fromEntries((Object.keys(VIDEO_VARIANTS) as Array<keyof typeof VIDEO_VARIANTS>).map((variant) => {
    const labels = pairs.filter((pair) => pair.variant === variant).map((pair) => labelById.get(pair.id)).filter(Boolean) as PairLabel[];
    const grades = labels.map((label) => label.topic + label.format_hook + label.transferability);
    const outlierRate = mean(raw[variant].outliers.map(Number)) ?? 0;
    return [variant, {
      mean_blind_grade: mean(grades),
      lists_with_5_unique_channels: mean(raw[variant].listUniquePass.map(Number)),
      neighbor_outlier_rate: outlierRate,
      neighbor_outlier_lift: libraryOutlierRate ? outlierRate / libraryOutlierRate : null,
      median_similarity: percentile(raw[variant].similarities, 0.5),
      judged_pairs: labels.length,
    }];
  }));
  const winner = Object.entries(variants).sort((a, b) => (b[1].mean_blind_grade ?? 0) - (a[1].mean_blind_grade ?? 0))[0][0];
  return { seeds: seeds.length, library_outlier_rate: libraryOutlierRate, judge_model: 'gpt-5-mini', judge_cost_usd: judged.costUsd, variants, winner };
}

async function expandQueries(client: OpenAI, queries: GoldQuery[]): Promise<{ expansions: QueryExpansion[]; costUsd: number }> {
  const completion = await client.chat.completions.create({
    model: 'gpt-5-mini',
    reasoning_effort: 'minimal',
    messages: [
      {
        role: 'system',
        content: 'Rewrite each YouTube channel-search query into three short retrieval queries: literal, the audience problem it serves, and its format or emotional hook. Preserve named entities for known-item lookups. Return every id exactly once.',
      },
      { role: 'user', content: JSON.stringify(queries.map(({ id, query }) => ({ id, query }))) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'query_expansions',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            queries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' }, literal: { type: 'string' },
                  audience_problem: { type: 'string' }, format_hook: { type: 'string' },
                },
                required: ['id', 'literal', 'audience_problem', 'format_hook'],
                additionalProperties: false,
              },
            },
          },
          required: ['queries'],
          additionalProperties: false,
        },
      },
    },
    max_completion_tokens: 8_000,
  });
  const parsed = JSON.parse(completion.choices[0]?.message.content ?? '{"queries":[]}') as { queries: QueryExpansion[] };
  if (parsed.queries.length !== queries.length) throw new Error(`Expansion returned ${parsed.queries.length}/${queries.length} queries`);
  return { expansions: parsed.queries, costUsd: await logGenerationCost(completion.usage) };
}

function metricsFor(queries: GoldQuery[], resultIds: Map<string, string[]>) {
  return Object.fromEntries((['known_item', 'discovery', 'analogue'] as const).map((stratum) => {
    const rows = queries.filter((query) => query.stratum === stratum);
    const values = rows.map((query) => {
      const grades = new Map(query.expected_channels.map((channel) => [channel.channel_id, channel.grade]));
      const ids = resultIds.get(query.id) ?? [];
      return { recall: recallAt(ids, grades, 10), mrr: mrr(ids, grades), ndcg: ndcgAt(ids, grades, 10) };
    });
    return [stratum, {
      recall: mean(values.map((value) => value.recall)),
      mrr: mean(values.map((value) => value.mrr)),
      ndcg: mean(values.map((value) => value.ndcg)),
    }];
  }));
}

async function evaluateQueryVariants(qdrant: SemanticQdrant, client: OpenAI, queries: GoldQuery[]) {
  const expanded = await expandQueries(client, queries);
  const expansionById = new Map(expanded.expansions.map((query) => [query.id, query]));
  const embeddingInputs = queries.flatMap((query) => {
    const forms = expansionById.get(query.id);
    if (!forms) throw new Error(`Missing expansion ${query.id}`);
    return [forms.literal, forms.audience_problem, forms.format_hook, `${query.query} for YouTube creators`];
  });
  const vectors = await embedTexts(embeddingInputs);
  const multiIds = new Map<string, string[]>();
  const prefixIds = new Map<string, string[]>();
  const multiLatencies: number[] = [];
  const prefixLatencies: number[] = [];

  for (const [index, query] of queries.entries()) {
    const queryVectors = vectors.slice(index * 4, index * 4 + 4);
    let started = performance.now();
    const lists = await Promise.all(queryVectors.slice(0, 3).map((vector) => qdrant.query<ChannelPayload>(CHANNEL_COLLECTION, vector, { limit: 10 })));
    multiLatencies.push(performance.now() - started);
    multiIds.set(query.id, reciprocalRankFuseMany(lists, (hit) => String(hit.payload.channel_id)).slice(0, 10).map((hit) => hit.payload.channel_id));
    started = performance.now();
    const prefix = await qdrant.query<ChannelPayload>(CHANNEL_COLLECTION, queryVectors[3], { limit: 10 });
    prefixLatencies.push(performance.now() - started);
    prefixIds.set(query.id, prefix.map((hit) => hit.payload.channel_id));
  }
  return {
    expansion_model: 'gpt-5-mini',
    expansion_cost_usd: expanded.costUsd,
    multi_query: { metrics: metricsFor(queries, multiIds), p95_ms: percentile(multiLatencies, 0.95) },
    creator_prefix: { metrics: metricsFor(queries, prefixIds), p95_ms: percentile(prefixLatencies, 0.95) },
  };
}

export async function evaluateMethods(): Promise<void> {
  const gold = JSON.parse(await fs.readFile(path.resolve('docs/prd/semantic-gold-channels.json'), 'utf8')) as GoldFile;
  const qdrant = new SemanticQdrant();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const videoDocuments = await evaluateVideoVariants(qdrant, client);
  const queryStrategies = await evaluateQueryVariants(qdrant, client, gold.queries);
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    video_documents: videoDocuments,
    query_strategies: queryStrategies,
  }, null, 2)}\n`);
  console.log(`wrote method results to ${OUTPUT_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(evaluateMethods);
