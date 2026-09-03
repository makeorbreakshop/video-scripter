import fs from 'fs/promises';
import path from 'path';
import { mean, mrr, ndcgAt, percentile, recallAt } from '../../lib/semantic/eval';
import { embedTexts } from '../../lib/semantic/embed';
import { reciprocalRankFuseMany, SemanticQdrant } from '../../lib/semantic/qdrant';
import { CHANNEL_BREAKOUT_COLLECTION, CHANNEL_MEAN_COLLECTION } from './build-channel-prototypes';
import { runMain } from './common';

const OUTPUT_PATH = path.resolve('docs/prd/semantic-channel-variant-results.json');
const API_BASE = process.env.SEMANTIC_EVAL_API_URL ?? 'http://localhost:3300/api/v1';

interface ExpectedChannel { channel_id: string; grade: number }
interface GoldQuery {
  id: string;
  stratum: 'known_item' | 'discovery' | 'analogue';
  query: string;
  expected_channels: ExpectedChannel[];
}
interface GoldFile { queries: GoldQuery[] }
interface ChannelPayload { channel_id: string }
interface SearchResponse { channels: Array<{ id: string }> }

async function apiKey(): Promise<string> {
  if (process.env.CHANNELSMITH_API_KEY) return process.env.CHANNELSMITH_API_KEY;
  return (await fs.readFile(path.resolve('.secrets/api-key-brandon.txt'), 'utf8')).trim();
}

async function lexicalResults(queries: GoldQuery[]): Promise<Map<string, string[]>> {
  const key = await apiKey();
  const output = new Map<string, string[]>();
  for (const query of queries) {
    let response: Response;
    for (;;) {
      response = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query.query)}&mode=lexical&limit=10`, {
        headers: { authorization: `Bearer ${key}` },
      });
      if (response.status !== 429) break;
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, Number(response.headers.get('retry-after') ?? 1)) * 1_000));
    }
    if (!response.ok) throw new Error(`Lexical query failed: HTTP ${response.status}`);
    const data = await response.json() as SearchResponse;
    output.set(query.id, data.channels.map((channel) => channel.id));
  }
  return output;
}

async function queryCollection(
  qdrant: SemanticQdrant,
  collection: string,
  queries: GoldQuery[],
  vectors: number[][],
): Promise<{ ids: Map<string, string[]>; p95Ms: number | null }> {
  const ids = new Map<string, string[]>();
  const latencies: number[] = [];
  for (const [index, query] of queries.entries()) {
    const started = performance.now();
    const hits = await qdrant.query<ChannelPayload>(collection, vectors[index], { limit: 10 });
    latencies.push(performance.now() - started);
    ids.set(query.id, hits.map((hit) => hit.payload.channel_id));
  }
  return { ids, p95Ms: percentile(latencies, 0.95) };
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

function fuseMaps(queries: GoldQuery[], ...maps: Array<Map<string, string[]>>): Map<string, string[]> {
  return new Map(queries.map((query) => [
    query.id,
    reciprocalRankFuseMany(
      maps.map((map) => (map.get(query.id) ?? []).map((id) => ({ id }))),
      (item) => item.id,
    ).slice(0, 10).map((item) => item.id),
  ]));
}

export async function evaluateChannelVariants(): Promise<void> {
  const gold = JSON.parse(await fs.readFile(path.resolve('docs/prd/semantic-gold-channels.json'), 'utf8')) as GoldFile;
  const queries = gold.queries;
  const qdrant = new SemanticQdrant({ timeoutMs: 30_000 });
  const vectors512 = await embedTexts(queries.map((query) => query.query), { dimensions: 512 });
  const vectors1536 = await embedTexts(queries.map((query) => query.query), { dimensions: 1536 });
  const [aggregate, titles, meanVectors, breakout, dimensions1536, lexical] = await Promise.all([
    queryCollection(qdrant, 'channels_v1', queries, vectors512),
    queryCollection(qdrant, 'channels_titles_v1', queries, vectors512),
    queryCollection(qdrant, CHANNEL_MEAN_COLLECTION, queries, vectors512),
    queryCollection(qdrant, CHANNEL_BREAKOUT_COLLECTION, queries, vectors512),
    queryCollection(qdrant, 'channels_1536_v1', queries, vectors1536),
    lexicalResults(queries),
  ]);
  const identityBreakout = fuseMaps(queries, aggregate.ids, breakout.ids);
  const meanLexical = fuseMaps(queries, meanVectors.ids, lexical);
  const meanLexical2x = fuseMaps(queries, meanVectors.ids, lexical, lexical);
  const results = {
    dimensions: {
      '512': { metrics: metricsFor(queries, aggregate.ids), p95_ms: aggregate.p95Ms },
      '1536': { metrics: metricsFor(queries, dimensions1536.ids), p95_ms: dimensions1536.p95Ms },
    },
    channel_documents: {
      titles: { metrics: metricsFor(queries, titles.ids), p95_ms: titles.p95Ms },
      titles_niches: { metrics: metricsFor(queries, aggregate.ids), p95_ms: aggregate.p95Ms },
      mean_video_vectors: { metrics: metricsFor(queries, meanVectors.ids), p95_ms: meanVectors.p95Ms },
    },
    channel_representations: {
      aggregate: { metrics: metricsFor(queries, aggregate.ids), p95_ms: aggregate.p95Ms },
      identity_plus_breakout_rrf: { metrics: metricsFor(queries, identityBreakout), p95_ms: Math.max(aggregate.p95Ms ?? 0, breakout.p95Ms ?? 0) },
      mean_plus_lexical_rrf: { metrics: metricsFor(queries, meanLexical), p95_ms: meanVectors.p95Ms },
      mean_plus_lexical_2x_rrf: { metrics: metricsFor(queries, meanLexical2x), p95_ms: meanVectors.p95Ms },
    },
  };
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify({ generated_at: new Date().toISOString(), ...results }, null, 2)}\n`);
  console.log(`wrote channel variant results to ${OUTPUT_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(evaluateChannelVariants);
