import OpenAI from 'openai';
import { facetPromptInput, parseFacetResult, SEMANTIC_FACET_PROMPT_VERSION, SemanticFacets } from '../../lib/semantic/facets';
import { db, floatArg, intArg, runMain } from './common';

const MODEL = process.env.SEMANTIC_FACET_MODEL ?? 'gpt-5-nano';
const BACKFILL_SCORE_VERSION = 'v3.1-semantic-backfill-2026-09';
const INPUT_USD_PER_M = 0.25;
const OUTPUT_USD_PER_M = 2.00;

interface CandidateRow {
  id: string;
  title: string;
  channel_name: string;
  description: string | null;
  topic_label: string | null;
}

interface Extraction {
  video_id: string;
  source_hash: string;
  facets: SemanticFacets;
}

function costUsd(usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined): number {
  return ((usage?.prompt_tokens ?? 0) * INPUT_USD_PER_M + (usage?.completion_tokens ?? 0) * OUTPUT_USD_PER_M) / 1_000_000;
}

function tokenCount(usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined): number {
  return usage?.total_tokens ?? ((usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0));
}

async function logCost(tokens: number, usd: number): Promise<void> {
  await db().query(
    `insert into semantic_cost_ledger (date, tokens, usd) values (current_date, $1, $2)`,
    [tokens, usd],
  );
}

async function loadCandidates(limit: number): Promise<CandidateRow[]> {
  const result = await db().query<CandidateRow>(
    `select v.id,
            v.title,
            coalesce(v.channel_name, cm.title, v.channel_id) as channel_name,
            v.description,
            coalesce(v.topic_micro, v.topic_niche, v.topic_domain) as topic_label
       from video_scores s
       join videos v on v.id = s.video_id
       left join channel_meta cm on cm.channel_id = v.channel_id
      where s.model_version = $1
        and s.score >= 2
        and s.confidence in ('likely','confirmed')
        and v.published_at >= now() - interval '365 days'
        and coalesce(v.is_short,false) = false
        and coalesce(v.duration,'') <> 'P0D'
        and not exists (
          select 1 from video_facets f
           where f.video_id = v.id
             and f.prompt_version = $2
             and f.model = $3
        )
      order by s.score desc, v.published_at desc
      limit $4`,
    [BACKFILL_SCORE_VERSION, SEMANTIC_FACET_PROMPT_VERSION, MODEL, limit],
  );
  return result.rows;
}

async function extractBatch(client: OpenAI, rows: CandidateRow[]): Promise<{ extractions: Extraction[]; tokens: number; usd: number }> {
  const inputs = rows.map((row) => facetPromptInput({
    id: row.id,
    title: row.title,
    channelName: row.channel_name,
    description: row.description,
    topicLabel: row.topic_label,
  }));
  const completion = await client.chat.completions.create({
    model: MODEL,
    reasoning_effort: 'minimal',
    messages: [
      {
        role: 'system',
        content: [
          'Extract YouTube packaging facets from title/channel/description only.',
          'Do not infer verified performance or content truth.',
          'evidence_status must always be packaging_only.',
          'purpose_abstract and mechanism_abstract are mandatory and should be cross-niche abstractions.',
          'Return one facet object per video_id, terse strings, null when unknown.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify(inputs.map(({ video_id, text }) => ({ video_id, text }))),
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'semantic_facets_v2',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            videos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  video_id: { type: 'string' },
                  niche: { type: ['string', 'null'] },
                  purpose: { type: ['string', 'null'] },
                  purpose_abstract: { type: 'string' },
                  mechanism: { type: ['string', 'null'] },
                  mechanism_abstract: { type: 'string' },
                  packaging_claim: { type: ['string', 'null'] },
                  evidence_status: { type: 'string', enum: ['packaging_only'] },
                  hook_device: { type: ['string', 'null'] },
                  format: { type: ['string', 'null'] },
                  confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
                },
                required: ['video_id', 'niche', 'purpose', 'purpose_abstract', 'mechanism', 'mechanism_abstract', 'packaging_claim', 'evidence_status', 'hook_device', 'format', 'confidence'],
                additionalProperties: false,
              },
            },
          },
          required: ['videos'],
          additionalProperties: false,
        },
      },
    },
    max_completion_tokens: Math.max(1_000, rows.length * 120),
  });
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error('Facet model returned no content');
  const parsed = JSON.parse(content) as { videos: Array<Record<string, unknown> & { video_id: string }> };
  const hashById = new Map(inputs.map((input) => [input.video_id, input.source_hash]));
  const expectedIds = new Set(hashById.keys());
  const seenIds = new Set<string>();
  return {
    extractions: parsed.videos.flatMap((item) => {
      if (!expectedIds.has(item.video_id) || seenIds.has(item.video_id)) return [];
      seenIds.add(item.video_id);
      const source_hash = hashById.get(item.video_id);
      if (!source_hash) return [];
      return [{ video_id: item.video_id, source_hash, facets: parseFacetResult(item) }];
    }),
    tokens: tokenCount(completion.usage),
    usd: costUsd(completion.usage),
  };
}

async function writeFacets(extractions: Extraction[]): Promise<void> {
  const uniqueExtractions = [...new Map(extractions.map((row) => [row.video_id, row])).values()];
  if (!uniqueExtractions.length) return;
  await db().query(
    `insert into video_facets (video_id, model, prompt_version, source_hash, facets, confidence, retry_count, extracted_at)
     select input.video_id, $4, $5, input.source_hash, input.facets::jsonb, input.confidence, 0, now()
       from unnest($1::text[], $2::text[], $3::text[], $6::text[]) as input(video_id, source_hash, facets, confidence)
     on conflict (video_id, model, prompt_version) do update
       set source_hash = excluded.source_hash,
           facets = excluded.facets,
           confidence = excluded.confidence,
           extracted_at = excluded.extracted_at`,
    [
      uniqueExtractions.map((row) => row.video_id),
      uniqueExtractions.map((row) => row.source_hash),
      uniqueExtractions.map((row) => JSON.stringify(row.facets)),
      MODEL,
      SEMANTIC_FACET_PROMPT_VERSION,
      uniqueExtractions.map((row) => row.facets.confidence),
    ],
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMain(async () => {
    const limit = intArg(process.argv, '--limit') ?? 200;
    const batchSize = Math.min(intArg(process.argv, '--batch-size') ?? 25, 50);
    const maxUsd = floatArg(process.argv, '--max-usd') ?? 0.2;
    const write = process.argv.includes('--write');
    const candidates = await loadCandidates(limit);
    if (!write) {
      console.log(JSON.stringify({
        mode: 'dry-run',
        model: MODEL,
        prompt_version: SEMANTIC_FACET_PROMPT_VERSION,
        candidates: candidates.length,
        max_usd: maxUsd,
      }, null, 2));
      return;
    }
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let totalUsd = 0;
    let totalTokens = 0;
    let written = 0;
    for (let index = 0; index < candidates.length; index += batchSize) {
      const batch = candidates.slice(index, index + batchSize);
      const result = await extractBatch(client, batch);
      if (totalUsd + result.usd > maxUsd) {
        throw new Error(`Facet extraction would exceed --max-usd ${maxUsd.toFixed(4)}; spent ${totalUsd.toFixed(4)}, next batch ${result.usd.toFixed(4)}`);
      }
      await logCost(result.tokens, result.usd);
      await writeFacets(result.extractions);
      totalUsd += result.usd;
      totalTokens += result.tokens;
      written += result.extractions.length;
      console.log(`progress: written=${written}/${candidates.length} tokens=${totalTokens} usd=${totalUsd.toFixed(6)}`);
    }
    console.log(JSON.stringify({
      mode: 'write',
      model: MODEL,
      prompt_version: SEMANTIC_FACET_PROMPT_VERSION,
      candidates: candidates.length,
      written,
      tokens: totalTokens,
      usd: totalUsd,
    }, null, 2));
  });
}
