import { buildVideoDocument, docHash, EMBEDDING_DIMS, EMBEDDING_MODEL, mapVideoPayload, VideoPayloadRow } from '../../lib/semantic/documents';
import { embedTexts, estimateEmbeddingRun, assertEmbeddingBudget } from '../../lib/semantic/embed';
import { SemanticQdrant, uuid5ForId } from '../../lib/semantic/qdrant';
import { db, floatArg, intArg, runMain } from './common';

const COLLECTION = 'videos_v2';

interface FacetEmbeddingRow extends VideoPayloadRow {
  description: string | null;
  facets: {
    niche?: string | null;
    purpose_abstract?: string | null;
    mechanism_abstract?: string | null;
  };
  facet_model: string;
  prompt_version: string;
  source_hash: string;
}

async function loadRows(limit: number): Promise<FacetEmbeddingRow[]> {
  const result = await db().query<FacetEmbeddingRow>(
    `select v.id,
            v.channel_id,
            coalesce(v.channel_name, cm.title, v.channel_id) as channel_name,
            v.title,
            v.description,
            v.published_at,
            v.view_count,
            v.topic_domain,
            v.topic_niche,
            v.topic_micro,
            v.format_type,
            s.score,
            s.confidence,
            s.est30,
            s.baseline,
            f.facets,
            f.model as facet_model,
            f.prompt_version,
            f.source_hash
       from video_facets f
       join videos v on v.id = f.video_id
       left join channel_meta cm on cm.channel_id = v.channel_id
       left join video_scores s on s.video_id = v.id
      where f.prompt_version = 'semantic_facets_v2_2026_09_03'
      order by f.extracted_at desc
      limit $1`,
    [limit],
  );
  return result.rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMain(async () => {
    const limit = intArg(process.argv, '--limit') ?? 250;
    const maxUsd = floatArg(process.argv, '--max-usd') ?? 0.05;
    const write = process.argv.includes('--write');
    const rows = await loadRows(limit);
    const inputs = rows.flatMap((row) => [
      buildVideoDocument({ title: row.title, channelName: row.channel_name, topicNiche: row.topic_niche }),
      row.facets.purpose_abstract?.trim() || 'unknown purpose',
      row.facets.mechanism_abstract?.trim() || 'unknown mechanism',
      row.facets.niche?.trim() || 'unknown niche',
    ]);
    const estimate = estimateEmbeddingRun(inputs);
    assertEmbeddingBudget(estimate, maxUsd);
    if (!write) {
      console.log(JSON.stringify({ mode: 'dry-run', collection: COLLECTION, rows: rows.length, estimate }, null, 2));
      return;
    }
    const vectors = await embedTexts(inputs);
    const qdrant = new SemanticQdrant({ timeoutMs: 30_000 });
    await qdrant.upsert(COLLECTION, rows.map((row, index) => {
      const title = vectors[index * 4];
      const purpose = vectors[index * 4 + 1];
      const mechanism = vectors[index * 4 + 2];
      const niche = vectors[index * 4 + 3];
      return {
        id: uuid5ForId(row.id),
        vector: { title, purpose, mechanism, niche, detopic: title },
        payload: {
          ...mapVideoPayload(row),
          facet_model: row.facet_model,
          facet_prompt_version: row.prompt_version,
          facet_source_hash: row.source_hash,
          vector_hash: docHash([row.title, row.facets.purpose_abstract, row.facets.mechanism_abstract, row.facets.niche].join('\n')),
        },
      };
    }));
    console.log(JSON.stringify({ mode: 'write', collection: COLLECTION, rows: rows.length, estimate }, null, 2));
  });
}
