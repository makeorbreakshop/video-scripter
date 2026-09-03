import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
  EMBEDDING_DIMS,
  EMBEDDING_MODEL,
  buildChannelDocument,
  buildV4VideoDocument,
  docHash,
} from '../../lib/semantic/documents';
import { assertEmbeddingBudget, embedTexts, estimateEmbeddingRun } from '../../lib/semantic/embed';
import { pendingDocuments } from '../../lib/semantic/eval-v4';
import { SemanticQdrant, uuid5ForId } from '../../lib/semantic/qdrant';
import { cleanDescriptionForRetrieval, wellFormedText } from '../../lib/semantic/text';
import { chunks, costToday, db, floatArg, QDRANT_BATCH_SIZE, READ_BATCH_SIZE, runMain } from './common';

const EVAL_DIR = path.resolve('docs/prd/semantic-eval-v4');
const VIDEO_COLLECTION = 'videos_eval_v4';
const CHANNEL_COLLECTION = 'channels_eval_v4';
const EVAL_QDRANT_BATCH_SIZE = Math.min(100, QDRANT_BATCH_SIZE);

interface CorpusManifest {
  as_of: string;
  content_hash: string;
  ids_hash: string;
  ids: string[];
}

interface VideoEvidence {
  id: string;
  channel_id: string;
  published_at: string;
  model_version: string;
  scored_at: string;
  score: number;
  confidence: string;
  n_baseline: number;
  baseline: number;
}

interface VideoSource {
  id: string;
  channel_id: string;
  channel_name: string;
  title: string;
  description: string | null;
  published_at: Date;
  thumbnail_url: string | null;
}

interface ChannelSourceRow {
  channel_id: string;
  name: string;
  subscriber_count: string;
  video_count: string;
  title: string | null;
  view_count: string | null;
  published_at: Date | null;
  topic_niche: string | null;
}

interface PreparedDocument {
  id: string;
  document: string;
  hash: string;
  payload: Record<string, unknown>;
}

type EmbeddedPoint = {
  sourceId: string;
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
};

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(EVAL_DIR, name), 'utf8')) as T;
}

function aggregateHash(rows: PreparedDocument[]): string {
  return createHash('sha256')
    .update([...rows].sort((a, b) => a.id.localeCompare(b.id)).map((row) => `${row.id}\0${row.hash}`).join('\n'))
    .digest('hex');
}

async function loadVideoDocuments(manifest: CorpusManifest, evidence: VideoEvidence[]): Promise<PreparedDocument[]> {
  const evidenceById = new Map(evidence.map((row) => [row.id, row]));
  const prepared: PreparedDocument[] = [];
  for (const batch of chunks(manifest.ids, READ_BATCH_SIZE)) {
    const result = await db().query<VideoSource>(
      `select input.id, v.channel_id, coalesce(v.channel_name, cm.title, v.channel_id) as channel_name,
              v.title, v.description, v.published_at, v.thumbnail_url
         from unnest($1::text[]) as input(id)
         join videos v on v.id = input.id
         left join channel_meta cm on cm.channel_id = v.channel_id
        order by input.id`,
      [batch],
    );
    for (const row of result.rows) {
      const frozen = evidenceById.get(row.id);
      if (!frozen) throw new Error(`missing frozen eligibility evidence for ${row.id}`);
      const cleanedDescription = cleanDescriptionForRetrieval(row.description);
      const title = wellFormedText(row.title);
      const channelName = wellFormedText(row.channel_name);
      const document = buildV4VideoDocument({
        title,
        channelName,
        description: cleanedDescription,
      });
      prepared.push({
        id: row.id,
        document,
        hash: docHash(document),
        payload: {
          entity_id: row.id,
          video_id: row.id,
          channel_id: row.channel_id,
          channel_name: channelName,
          title,
          description: cleanedDescription,
          published_at: Math.floor(new Date(frozen.published_at).getTime() / 1_000),
          thumbnail_url: row.thumbnail_url == null ? null : wellFormedText(row.thumbnail_url),
          score_model_version: frozen.model_version,
          scored_at: frozen.scored_at,
          score: frozen.score,
          confidence: frozen.confidence,
          n_baseline: frozen.n_baseline,
          baseline: frozen.baseline,
          document,
          document_hash: docHash(document),
          corpus_hash: manifest.content_hash,
        },
      });
    }
  }
  if (prepared.length !== manifest.ids.length) {
    throw new Error(`video document coverage mismatch: ${prepared.length}/${manifest.ids.length}`);
  }
  return prepared;
}

async function loadChannelDocuments(manifest: CorpusManifest): Promise<PreparedDocument[]> {
  const prepared: PreparedDocument[] = [];
  for (const batch of chunks(manifest.ids, Math.min(500, READ_BATCH_SIZE))) {
    const result = await db().query<ChannelSourceRow>(
      `select input.channel_id, cd.name, cm.subscriber_count::text, cm.video_count::text,
              recent.title, recent.view_count::text, recent.published_at, recent.topic_niche
         from unnest($1::text[]) as input(channel_id)
         join channel_directory cd on cd.channel_id = input.channel_id
         join channel_meta cm on cm.channel_id = input.channel_id
         left join lateral (
           select v.title, v.view_count, v.published_at, v.topic_niche
             from videos v
            where v.channel_id = input.channel_id
              and v.published_at between $2::timestamptz - interval '365 days' and $2::timestamptz
              and coalesce(v.is_short, false) = false
              and coalesce(v.duration, '') <> 'P0D'
              and coalesce(v.is_institutional, false) = false
              and nullif(btrim(v.title), '') is not null
            order by v.view_count desc nulls last, v.published_at desc, v.id
            limit 20
         ) recent on true
        order by input.channel_id, recent.view_count desc nulls last, recent.published_at desc`,
      [batch, manifest.as_of],
    );
    const grouped = new Map<string, ChannelSourceRow[]>();
    for (const row of result.rows) {
      const list = grouped.get(row.channel_id) ?? [];
      list.push(row);
      grouped.set(row.channel_id, list);
    }
    for (const id of batch) {
      const rows = grouped.get(id);
      if (!rows?.length) throw new Error(`missing channel source ${id}`);
      const first = rows[0];
      const name = wellFormedText(first.name);
      const document = buildChannelDocument({
        name,
        videos: rows.flatMap((row) => row.title && row.published_at ? [{
          title: wellFormedText(row.title),
          viewCount: row.view_count,
          publishedAt: row.published_at,
          topicNiche: row.topic_niche,
        }] : []),
      });
      prepared.push({
        id,
        document,
        hash: docHash(document),
        payload: {
          entity_id: id,
          channel_id: id,
          name,
          channel_name: name,
          subscriber_count: Number(first.subscriber_count),
          video_count: Number(first.video_count),
          document,
          document_hash: docHash(document),
          corpus_hash: manifest.content_hash,
        },
      });
    }
  }
  if (prepared.length !== manifest.ids.length) {
    throw new Error(`channel document coverage mismatch: ${prepared.length}/${manifest.ids.length}`);
  }
  return prepared;
}

async function ensureCollection(name: string): Promise<void> {
  const baseUrl = (process.env.QDRANT_URL ?? '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('QDRANT_URL is not set');
  const headers = {
    'content-type': 'application/json',
    ...(process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {}),
  };
  const existing = await fetch(`${baseUrl}/collections/${name}`, { headers });
  if (existing.status !== 404) {
    if (!existing.ok) throw new Error(`unable to inspect ${name}: HTTP ${existing.status}`);
    return;
  }
  const created = await fetch(`${baseUrl}/collections/${name}?wait=true`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ vectors: { size: EMBEDDING_DIMS, distance: 'Cosine' }, on_disk_payload: true }),
  });
  if (!created.ok) throw new Error(`unable to create ${name}: HTTP ${created.status}`);
}

async function upsertWithIsolation(
  qdrant: SemanticQdrant,
  collection: string,
  points: EmbeddedPoint[],
): Promise<void> {
  try {
    await qdrant.upsert(collection, points.map(({ sourceId: _sourceId, ...point }) => point));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/HTTP 400\b/.test(message) || points.length === 1) {
      const first = points[0]?.sourceId ?? 'unknown';
      const last = points.at(-1)?.sourceId ?? 'unknown';
      throw new Error(`${collection} upsert failed for ${first}..${last}: ${message}`, { cause: error });
    }
    const middle = Math.ceil(points.length / 2);
    await upsertWithIsolation(qdrant, collection, points.slice(0, middle));
    await upsertWithIsolation(qdrant, collection, points.slice(middle));
  }
}

async function embedCollection(name: string, rows: PreparedDocument[], maxUsd: number): Promise<number> {
  const qdrant = new SemanticQdrant({ timeoutMs: 30_000 });
  await ensureCollection(name);
  const existingHashes = new Map<string, string>();
  let offset: string | number | undefined;
  do {
    const page = await qdrant.scroll<{ entity_id?: string; document_hash?: string }>(name, { limit: 1_000, offset });
    for (const point of page.points) {
      if (point.payload.entity_id && point.payload.document_hash) {
        existingHashes.set(point.payload.entity_id, point.payload.document_hash);
      }
    }
    offset = page.nextPageOffset;
  } while (offset != null);
  const pending = pendingDocuments(rows, existingHashes);
  console.log(`${name}: existing=${rows.length - pending.length} pending=${pending.length}`);
  let actualUsd = 0;
  for (const batch of chunks(pending, EVAL_QDRANT_BATCH_SIZE)) {
    const vectors = await embedTexts(batch.map((row) => row.document), {
      dimensions: EMBEDDING_DIMS,
      onUsage: (_tokens, usd) => { actualUsd += usd; },
    });
    if (actualUsd > maxUsd) throw new Error(`actual embedding cost exceeded $${maxUsd.toFixed(2)}`);
    await upsertWithIsolation(qdrant, name, batch.map((row, index) => ({
      sourceId: row.id,
      id: uuid5ForId(row.id),
      vector: vectors[index],
      payload: row.payload,
    })));
  }
  const count = await qdrant.count(name);
  if (count !== rows.length) throw new Error(`${name} count mismatch: ${count}/${rows.length}`);
  return count;
}

async function materialize(): Promise<void> {
  const write = process.argv.includes('--write');
  const maxUsd = floatArg(process.argv, '--max-usd') ?? 2;
  const [videoManifest, channelManifest, videoEvidence] = await Promise.all([
    readJson<CorpusManifest>('video-corpus.json'),
    readJson<CorpusManifest>('channel-corpus.json'),
    readJson<VideoEvidence[]>('video-corpus-evidence.json'),
  ]);
  if (videoManifest.as_of !== channelManifest.as_of) throw new Error('video/channel as_of mismatch');
  const [videos, channels] = await Promise.all([
    loadVideoDocuments(videoManifest, videoEvidence),
    loadChannelDocuments(channelManifest),
  ]);
  const estimate = estimateEmbeddingRun([...videos, ...channels].map((row) => row.document));
  assertEmbeddingBudget(estimate, maxUsd);
  const documentManifest = {
    version: 4,
    as_of: videoManifest.as_of,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMS,
    video_collection: VIDEO_COLLECTION,
    channel_collection: CHANNEL_COLLECTION,
    videos: videos.length,
    channels: channels.length,
    video_documents_hash: aggregateHash(videos),
    channel_documents_hash: aggregateHash(channels),
    estimated_tokens: estimate.tokens,
    estimated_usd: estimate.est_usd,
  };
  console.log(JSON.stringify({ mode: write ? 'write' : 'dry-run', ...documentManifest, max_usd: maxUsd }, null, 2));
  if (!write) return;

  const channelCount = await embedCollection(CHANNEL_COLLECTION, channels, maxUsd);
  const videoCount = await embedCollection(VIDEO_COLLECTION, videos, maxUsd);
  await fs.writeFile(path.join(EVAL_DIR, 'documents.json'), `${JSON.stringify({
    ...documentManifest,
    video_qdrant_count: videoCount,
    channel_qdrant_count: channelCount,
  })}\n`);
  const cost = await costToday();
  console.log(JSON.stringify({ video_qdrant_count: videoCount, channel_qdrant_count: channelCount, semantic_cost_today: cost }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(materialize);
