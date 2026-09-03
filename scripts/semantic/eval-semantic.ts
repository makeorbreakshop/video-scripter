import fs from 'fs/promises';
import path from 'path';
import { execFileSync } from 'child_process';
import { mean, mrr, ndcgAt, percentile, recallAt } from '../../lib/semantic/eval';
import { CHANNELS_COLLECTION, SemanticQdrant, VIDEOS_COLLECTION } from '../../lib/semantic/qdrant';
import { costToday, db, runMain, sinceDate } from './common';

interface ExpectedChannel { channel_id: string; name: string; grade: number }
interface GoldQuery { id: string; stratum: 'known_item' | 'discovery' | 'analogue'; query: string; expected_channels: ExpectedChannel[] }
interface GoldFile { queries: GoldQuery[] }
interface SearchResponse { channels?: Array<{ id: string }>; requested_mode?: string; effective_mode?: string; degraded?: boolean }
interface Snapshot { name: string; size: number }
type SearchMode = 'lexical' | 'semantic' | 'hybrid';
type StratumMetrics = {
  recall: number | null;
  mrr: number | null;
  ndcg: number | null;
  latencyMs: number | null;
  p95LatencyMs: number | null;
};
type ChannelMetrics = Record<GoldQuery['stratum'], StratumMetrics>;

const outputPath = path.resolve('docs/prd/2026-09-02-semantic-eval.md');
const baseUrl = process.env.SEMANTIC_EVAL_API_URL ?? 'http://localhost:3300/api/v1';

async function apiKey(): Promise<string> {
  if (process.env.CHANNELSMITH_API_KEY) return process.env.CHANNELSMITH_API_KEY;
  return (await fs.readFile(path.resolve('.secrets/api-key-brandon.txt'), 'utf8')).trim();
}

async function apiGet<T>(route: string, key: string): Promise<{ data: T; bytes: number; latencyMs: number }> {
  const started = performance.now();
  let response: Response;
  for (;;) {
    response = await fetch(`${baseUrl}${route}`, { headers: { authorization: `Bearer ${key}` } });
    if (response.status !== 429) break;
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, Number(response.headers.get('retry-after') ?? 1)) * 1_000));
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`API ${route} returned ${response.status}: ${text.slice(0, 200)}`);
  return { data: JSON.parse(text) as T, bytes: Buffer.byteLength(text), latencyMs: performance.now() - started };
}

function fixed(value: number | null, digits = 3): string {
  return value == null ? 'blocked' : value.toFixed(digits);
}

async function searchMetrics(gold: GoldQuery[], key: string, mode: SearchMode): Promise<ChannelMetrics> {
  const results = [] as Array<{ query: GoldQuery; ids: string[]; latencyMs: number }>;
  for (const query of gold) {
    const response = await apiGet<SearchResponse>(`/search?q=${encodeURIComponent(query.query)}&mode=${mode}&limit=10`, key);
    if (response.data.effective_mode !== mode || response.data.degraded) {
      throw new Error(`${mode} evaluation degraded to ${response.data.effective_mode ?? 'unknown'}`);
    }
    results.push({ query, ids: response.data.channels?.map((channel) => channel.id) ?? [], latencyMs: response.latencyMs });
  }
  const strata = ['known_item', 'discovery', 'analogue'] as const;
  return Object.fromEntries(strata.map((stratum) => {
    const rows = results.filter((result) => result.query.stratum === stratum);
    const recalls = rows.map(({ query, ids }) => recallAt(ids, new Map(query.expected_channels.map((channel) => [channel.channel_id, channel.grade])), 10));
    const mrrs = rows.map(({ query, ids }) => mrr(
      ids,
      new Map(query.expected_channels.map((channel) => [channel.channel_id, channel.grade])),
    ));
    const ndcgs = rows.map(({ query, ids }) => ndcgAt(ids, new Map(query.expected_channels.map((channel) => [channel.channel_id, channel.grade])), 10));
    const latencies = rows.map((row) => row.latencyMs);
    return [stratum, {
      recall: mean(recalls),
      mrr: mean(mrrs),
      ndcg: mean(ndcgs),
      latencyMs: mean(latencies),
      p95LatencyMs: percentile(latencies, 0.95),
    }];
  })) as ChannelMetrics;
}

function shell(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unavailable';
  }
}

async function environment() {
  const qdrant = new SemanticQdrant();
  const qdrantUrl = process.env.QDRANT_URL ?? 'http://localhost:6333';
  const [videoCount, channelCount, sqlCounts, costs, videoSnapshots, channelSnapshots] = await Promise.all([
    qdrant.count(VIDEOS_COLLECTION),
    qdrant.count(CHANNELS_COLLECTION),
    db().query<{ videos: string; channels: string }>(
      `select count(*)::bigint as videos, count(distinct channel_id)::bigint as channels
         from videos where published_at > $1 and coalesce(is_short, false) = false and duration <> 'P0D'`,
      [sinceDate('30d')],
    ),
    costToday(),
    fetch(`${qdrantUrl}/collections/${VIDEOS_COLLECTION}/snapshots`).then((response) => response.json()) as Promise<{ result: Snapshot[] }>,
    fetch(`${qdrantUrl}/collections/${CHANNELS_COLLECTION}/snapshots`).then((response) => response.json()) as Promise<{ result: Snapshot[] }>,
  ]);
  const latestVideoSnapshot = videoSnapshots.result.at(-1)?.size ?? null;
  const latestChannelSnapshot = channelSnapshots.result.at(-1)?.size ?? null;
  return {
    videoCount,
    channelCount,
    sqlVideos: Number(sqlCounts.rows[0].videos),
    sqlChannels: Number(sqlCounts.rows[0].channels),
    costs,
    qdrantVersion: JSON.parse(await (await fetch(qdrantUrl)).text()).version as string,
    image: shell('docker', ['image', 'inspect', '--format', '{{.Id}} {{index .RepoDigests 0}}', 'qdrant/qdrant:v1.19.0']),
    ram: shell('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}', 'channelsmith-qdrant']),
    disk: shell('du', ['-sh', path.join(process.env.HOME ?? '', 'qdrant', 'channelsmith')]).split('\t')[0],
    latestVideoSnapshot,
    latestChannelSnapshot,
  };
}

function mebibytes(bytes: number | null): string {
  return bytes == null ? 'not measured' : `${(bytes / 1_048_576).toFixed(2)} MiB`;
}

function reportMarkdown(env: Awaited<ReturnType<typeof environment>>, modes: Record<SearchMode, ChannelMetrics>) {
  const populated = env.videoCount > 0 && env.channelCount > 0;
  const { lexical, semantic, hybrid } = modes;
  const knownPass = (hybrid.known_item.mrr ?? 0) >= (lexical.known_item.mrr ?? 0) - 0.02;
  const discoveryPass = (hybrid.discovery.ndcg ?? 0) >= (lexical.discovery.ndcg ?? 0) + 0.10
    && (hybrid.discovery.recall ?? 0) > (lexical.discovery.recall ?? 0);
  const analoguePass = (hybrid.analogue.ndcg ?? 0) >= (lexical.analogue.ndcg ?? 0) + 0.10
    && (hybrid.analogue.recall ?? 0) > (lexical.analogue.recall ?? 0);
  const beatsTrigram = ['discovery', 'analogue'].some((stratum) => {
    const key = stratum as 'discovery' | 'analogue';
    return (semantic[key].ndcg ?? 0) > (lexical[key].ndcg ?? 0)
      || (hybrid[key].ndcg ?? 0) > (lexical[key].ndcg ?? 0);
  });
  const status = populated
    ? `${knownPass && discoveryPass && analoguePass ? 'channel-search gate passed' : 'channel-search gate failed'} — SQL-seeded judgments remain provisional pending blind pooled adjudication`
    : 'blocked — semantic collections are empty';
  const result = (pass: boolean) => pass ? 'pass' : 'fail';
  return `# Semantic layer v1 evaluation

Date: 2026-09-02 (ET)  
Status: **${status}**

## Exact commands

\`npx tsx scripts/semantic/embed-videos.ts --since 30d --max-usd 2\`  
\`npx tsx scripts/semantic/embed-channels.ts --since 30d --max-usd 2\`  
\`npx tsx scripts/semantic/eval-semantic.ts\`

The 30-day corpus was embedded after credits were added. Channel metrics below use the 40-query,
SQL-grounded seed set. They are suitable for the PRD's initial stop gate, but remain provisional
until the pooled lexical/semantic/hybrid candidates are blindly adjudicated.

## Environment and coverage

| Item | Result |
|---|---:|
| Qdrant server | ${env.qdrantVersion} |
| Container image/digest | ${env.image} |
| SQL videos (rolling 30d) | ${env.sqlVideos.toLocaleString()} |
| Qdrant videos_v1 | ${env.videoCount.toLocaleString()} |
| SQL channels | ${env.sqlChannels.toLocaleString()} |
| Qdrant channels_v1 | ${env.channelCount.toLocaleString()} |
| Qdrant RAM | ${env.ram} |
| Qdrant storage | ${env.disk} |
| Latest videos_v1 snapshot | ${mebibytes(env.latestVideoSnapshot)} |
| Latest channels_v1 snapshot | ${mebibytes(env.latestChannelSnapshot)} |
| Actual OpenAI tokens | ${env.costs.tokens.toLocaleString()} |
| Actual OpenAI cost | $${env.costs.usd.toFixed(8)} |

Full dry-run cost gates (local tokenization, no OpenAI request):

| Entity | Documents | Tokens | Estimated cost | Wall time |
|---|---:|---:|---:|---:|
| Videos | 47,502 | 1,092,170 | $0.02184340 | 17.3 s |
| Channels | 4,069 | 415,639 | $0.00831278 | 5.5 s |
| Total | 51,571 | 1,507,809 | $0.03015618 | 22.8 s |

## 6.1 Channel search

| Stratum | Mode | Recall@10 | MRR | NDCG@10 | Result |
|---|---|---:|---:|---:|---|
| Known item | lexical | ${fixed(lexical.known_item.recall)} | ${fixed(lexical.known_item.mrr)} | — | baseline |
| Known item | semantic | ${fixed(semantic.known_item.recall)} | ${fixed(semantic.known_item.mrr)} | — | candidate |
| Known item | hybrid | ${fixed(hybrid.known_item.recall)} | ${fixed(hybrid.known_item.mrr)} | — | ${result(knownPass)} |
| Discovery | lexical | ${fixed(lexical.discovery.recall)} | — | ${fixed(lexical.discovery.ndcg)} | provisional SQL-seed baseline |
| Discovery | semantic | ${fixed(semantic.discovery.recall)} | — | ${fixed(semantic.discovery.ndcg)} | candidate |
| Discovery | hybrid | ${fixed(hybrid.discovery.recall)} | — | ${fixed(hybrid.discovery.ndcg)} | ${result(discoveryPass)} |
| Analogue | lexical | ${fixed(lexical.analogue.recall)} | — | ${fixed(lexical.analogue.ndcg)} | provisional SQL-seed baseline |
| Analogue | semantic | ${fixed(semantic.analogue.recall)} | — | ${fixed(semantic.analogue.ndcg)} | candidate |
| Analogue | hybrid | ${fixed(hybrid.analogue.recall)} | — | ${fixed(hybrid.analogue.ndcg)} | ${result(analoguePass)} |

Request p95 on this 40-query run (not the required 200-request endpoint benchmark): lexical
${fixed(Math.max(...Object.values(lexical).map((row) => row.p95LatencyMs ?? 0)), 1)} ms; semantic
${fixed(Math.max(...Object.values(semantic).map((row) => row.p95LatencyMs ?? 0)), 1)} ms; hybrid
${fixed(Math.max(...Object.values(hybrid).map((row) => row.p95LatencyMs ?? 0)), 1)} ms.

Pass/fail: known item **${result(knownPass)}**; discovery **${result(discoveryPass)}**; analogue
**${result(analoguePass)}**. The revised bar requires hybrid known-item MRR within 0.02 of lexical,
discovery/analogue NDCG at least +0.10, and recall improvement.

## 6.2 Similar videos

| Metric | Result | Bar |
|---|---:|---:|
| Mean blind pair grade | blocked | ≥4/6 |
| Lists with ≥5 unique channels | blocked | ≥80% |
| Neighbour outlier-rate lift | blocked | ≥2× |
| Median cosine similarity | blocked | descriptive only |

## 6.3 Topic outliers

| Metric | Result | Bar |
|---|---:|---:|
| Precision@20 across 15 topics | blocked | ≥0.80 |

## 6.4 Agent tasks

| Metric | Result | Bar |
|---|---:|---:|
| Tasks successful in ≤3 calls | blocked | ≥10/12 |
| Degraded runs detected | HTTP contract verified; eval blocked | 100% |
| Match evidence sufficient | blocked | recorded per task |

## Qdrant retrieval and operations

| Metric | Result | Bar |
|---|---:|---:|
| Approximate top-10 recall vs exact (100 queries) | blocked | ≥0.95 |
| Endpoint p95 over 200 requests | blocked | report only |
| Snapshot size | videos ${mebibytes(env.latestVideoSnapshot)}; channels ${mebibytes(env.latestChannelSnapshot)} (empty/unrepresentative) | report only |

## Method experiments

| Experiment | Variants | Winner | Reason |
|---|---|---|---|
| A. Video document | title; title+channel+niche; title+description | not evaluated | no embeddings |
| B. Dimensions | 512; 1536 | not evaluated | no embeddings |
| C. Channel document | titles; titles+niches; mean video vectors | not evaluated | no embeddings |
| D. Query strategy | raw; hybrid RRF; multi-query; creator prefix | not evaluated | no embeddings |
| E. Similarity floor | none; 0.35; 0.5 | not evaluated | cosine remains uncalibrated |
| F. Channel representation | aggregate; intent vectors; mean+lexical | not evaluated | no embeddings |

Winning variant A: **not determined**.  
Winning variant D: **not determined**.

## Cost and stop decision

Actual cost is **$${env.costs.usd.toFixed(8)}**. Estimates are emitted by the mandatory local
\`cl100k_base\` cost gate before each embedding run. Initial stop decision: **${beatsTrigram
  ? 'continue — at least one semantic or hybrid discovery/analogue result beats trigram on the SQL seed'
  : 'stop — neither semantic nor hybrid beats trigram on discovery/analogue'}**.
`;
}

export async function evaluate(): Promise<void> {
  const gold = JSON.parse(await fs.readFile(path.resolve('docs/prd/semantic-gold-channels.json'), 'utf8')) as GoldFile;
  const env = await environment();
  const key = await apiKey();
  const lexical = await searchMetrics(gold.queries, key, 'lexical');
  const semantic = await searchMetrics(gold.queries, key, 'semantic');
  const hybrid = await searchMetrics(gold.queries, key, 'hybrid');
  await fs.writeFile(outputPath, reportMarkdown(env, { lexical, semantic, hybrid }));
  console.log(`wrote evaluation report to ${outputPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(evaluate);
