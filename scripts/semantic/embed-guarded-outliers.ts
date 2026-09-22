// Embed the live guarded rolling-year outlier pool (title + channel + cleaned description, v4 document)
// into its own Qdrant collection so agent search covers every proven outlier, not the 30-day sync window
// or the frozen Sept 3 evaluation snapshot. Idempotent: existing points with an unchanged document hash
// are skipped. Usage: npx tsx scripts/semantic/embed-guarded-outliers.ts [--write] [--max-usd 0.5]
import { EMBEDDING_DIMS, EMBEDDING_MODEL, buildV4VideoDocument, docHash } from '../../lib/semantic/documents';
import { assertEmbeddingBudget, embedTexts, estimateEmbeddingRun } from '../../lib/semantic/embed';
import { SemanticQdrant, uuid5ForId } from '../../lib/semantic/qdrant';
import { cleanDescriptionForRetrieval, wellFormedText } from '../../lib/semantic/text';
import { chunks, costToday, db, floatArg, intArg, runMain } from './common';

export const GUARDED_COLLECTION = 'videos_guarded_v1';
const PAGE = 5_000;

interface Row {
  id: string; channel_id: string; channel_name: string; title: string; description: string | null;
  published_at: Date; thumbnail_url: string | null; view_count: string | null;
  score: string; confidence: string; n_baseline: string; baseline: string; model_version: string; scored_at: Date;
}

interface Prepared { id: string; document: string; hash: string; payload: Record<string, unknown> }

// Same guard as freeze-eval-v4 / the live outlier endpoint, one row per video (latest score).
async function loadGuarded(days: number): Promise<Prepared[]> {
  const out: Prepared[] = [];
  let cursor = '';
  for (;;) {
    const { rows } = await db().query<Row>(
      `select g.*, v.channel_id, coalesce(v.channel_name, cm.title, v.channel_id) as channel_name,
              v.title, v.description, v.published_at, v.thumbnail_url, v.view_count::text
         from (
           select distinct on (s.video_id) s.video_id as id, s.score::text, s.confidence, s.n_baseline::text,
                  s.baseline::text, s.model_version, s.scored_at
             from video_scores s
             join videos v on v.id = s.video_id
            where v.published_at >= now() - ($1::int * interval '1 day')
              and coalesce(v.is_short, false) = false
              and coalesce(v.duration, '') <> 'P0D'
              and coalesce(v.is_institutional, false) = false
              and nullif(btrim(v.title), '') is not null
              and s.score >= 2 and s.confidence in ('likely', 'confirmed')
              and s.n_baseline >= 5 and s.baseline >= 5000
              and s.video_id > $2
            order by s.video_id, s.scored_at desc
            limit $3
         ) g
         join videos v on v.id = g.id
         left join channel_meta cm on cm.channel_id = v.channel_id
        order by g.id`,
      [days, cursor, PAGE],
    );
    for (const row of rows) {
      const title = wellFormedText(row.title);
      const channelName = wellFormedText(row.channel_name);
      const description = cleanDescriptionForRetrieval(row.description);
      const document = buildV4VideoDocument({ title, channelName, description });
      out.push({
        id: row.id, document, hash: docHash(document),
        payload: {
          entity_id: row.id, video_id: row.id, channel_id: row.channel_id, channel_name: channelName, title, description,
          published_at: Math.floor(new Date(row.published_at).getTime() / 1_000),
          thumbnail_url: row.thumbnail_url ? wellFormedText(row.thumbnail_url) : null,
          view_count: row.view_count == null ? null : Number(row.view_count),
          score: Number(row.score), confidence: row.confidence, n_baseline: Number(row.n_baseline),
          baseline: Number(row.baseline), score_model_version: row.model_version, scored_at: row.scored_at,
          document, document_hash: docHash(document), corpus: `guarded-rolling-${days}d`,
        },
      });
    }
    console.log(`guarded: loaded ${out.length}`);
    if (rows.length < PAGE) break;
    cursor = rows[rows.length - 1].id;
  }
  return out;
}

async function ensureCollection(name: string): Promise<void> {
  const baseUrl = (process.env.QDRANT_URL ?? '').replace(/\/$/, '');
  const existing = await fetch(`${baseUrl}/collections/${name}`);
  if (existing.status !== 404) { if (!existing.ok) throw new Error(`inspect ${name}: HTTP ${existing.status}`); return; }
  const created = await fetch(`${baseUrl}/collections/${name}?wait=true`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ vectors: { size: EMBEDDING_DIMS, distance: 'Cosine' }, on_disk_payload: true }),
  });
  if (!created.ok) throw new Error(`create ${name}: HTTP ${created.status}`);
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const maxUsd = floatArg(process.argv, '--max-usd') ?? 0.5;
  const days = intArg(process.argv, '--days') ?? 365;
  const rows = await loadGuarded(days);
  const qdrant = new SemanticQdrant({ timeoutMs: 30_000 });
  await ensureCollection(GUARDED_COLLECTION);
  const existing = new Map<string, string>();
  let offset: string | number | undefined;
  do {
    const page = await qdrant.scroll<{ entity_id?: string; document_hash?: string }>(GUARDED_COLLECTION, { limit: 1_000, offset });
    for (const p of page.points) if (p.payload.entity_id && p.payload.document_hash) existing.set(p.payload.entity_id, p.payload.document_hash);
    offset = page.nextPageOffset;
  } while (offset != null);
  const pending = rows.filter((row) => existing.get(row.id) !== row.hash);
  const estimate = estimateEmbeddingRun(pending.map((row) => row.document));
  assertEmbeddingBudget(estimate, maxUsd);
  console.log(JSON.stringify({ mode: write ? 'write' : 'dry-run', collection: GUARDED_COLLECTION, model: EMBEDDING_MODEL,
    days, guarded: rows.length, existing_current: rows.length - pending.length, pending: pending.length, ...estimate, max_usd: maxUsd }));
  if (!write) return;
  let actualUsd = 0;
  for (const batch of chunks(pending, 100)) {
    const vectors = await embedTexts(batch.map((row) => row.document), { onUsage: (_t, usd) => { actualUsd += usd; } });
    if (actualUsd > maxUsd) throw new Error(`actual embedding cost exceeded $${maxUsd}`);
    await qdrant.upsert(GUARDED_COLLECTION, batch.map((row, i) => ({ id: uuid5ForId(row.id), vector: vectors[i], payload: row.payload })));
  }
  console.log(JSON.stringify({ qdrant_count: await qdrant.count(GUARDED_COLLECTION), actual_usd: actualUsd, semantic_cost_today: await costToday() }));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(main);
