// Embed the whole long-form catalog (title + channel + cleaned description, v4 document) into its own
// Qdrant collection so channel identity vectors can be built from a channel's typical videos, not its
// top-20 titles or its outliers. Streams the `videos` table in keyset pages so memory stays flat and
// each Postgres statement stays under the pool's 45 s timeout. Idempotent: a point whose payload
// document_hash matches is skipped, so re-runs only pay for new or changed videos.
//
// Egress budget (2026-09-14): ~882K long-form rows × ~1.4 KB projected = ~1.3 GB one-time read, against
// a measured 43-48 GB/day project baseline. Not a recurring job; the hourly sync should take over
// incrementally once this backfill lands.
//
// Usage: npx tsx scripts/semantic/embed-catalog.ts [--write] [--max-usd 10] [--limit N] [--since YYYY-MM-DD]
import { EMBEDDING_DIMS, EMBEDDING_MODEL, buildV4VideoDocument, docHash } from '../../lib/semantic/documents';
import { embedTexts, estimateEmbeddingRun } from '../../lib/semantic/embed';
import { SemanticQdrant, uuid5ForId } from '../../lib/semantic/qdrant';
import { cleanDescriptionForRetrieval, wellFormedText } from '../../lib/semantic/text';
import { channelIdsOf, pendingPoints } from '../../lib/semantic/catalog-sync';
import { argValue, chunks, costToday, db, floatArg, intArg, runMain } from './common';

export const CATALOG_COLLECTION = 'videos_catalog_v1';
const PAGE = 5_000;
const EMBED_BATCH = 100;

interface Row {
  id: string; channel_id: string; channel_name: string; title: string; description: string | null;
  published_at: Date; view_count: string | null;
}

interface Prepared { id: string; document: string; hash: string; payload: Record<string, unknown> }

function prepare(row: Row): Prepared {
  const title = wellFormedText(row.title);
  const channelName = wellFormedText(row.channel_name);
  const description = cleanDescriptionForRetrieval(row.description);
  const document = buildV4VideoDocument({ title, channelName, description });
  const hash = docHash(document);
  return {
    id: row.id, document, hash,
    // Slim payload on purpose: the identity-vector job needs channel + date, not the description.
    payload: {
      entity_id: row.id, video_id: row.id, channel_id: row.channel_id, channel_name: channelName, title,
      published_at: Math.floor(new Date(row.published_at).getTime() / 1_000),
      view_count: row.view_count == null ? null : Number(row.view_count),
      document_hash: hash, corpus: 'catalog-longform-v4',
    },
  };
}

const ROW_SELECT = `
  select v.id, v.channel_id, coalesce(v.channel_name, cm.title, v.channel_id) as channel_name,
         v.title, v.description, v.published_at, v.view_count::text
    from videos v
    left join channel_meta cm on cm.channel_id = v.channel_id`;

const LONGFORM_PREDICATE = `
  coalesce(v.is_short, false) = false
  and coalesce(v.duration, '') <> 'P0D'
  and coalesce(v.is_institutional, false) = false
  and nullif(btrim(v.title), '') is not null`;

/** Backfill: whole catalog in id order, so a full pass has a stable resumable cursor. */
async function* pages(since: string | Date | null): AsyncGenerator<Row[]> {
  let cursor = '';
  for (;;) {
    const { rows } = await db().query<Row>(
      `${ROW_SELECT}
        where v.id > $1
          and ${LONGFORM_PREDICATE}
          and ($3::timestamptz is null or v.published_at >= $3)
        order by v.id
        limit $2`,
      [cursor, PAGE, since],
    );
    if (!rows.length) return;
    yield rows;
    if (rows.length < PAGE) return;
    cursor = rows[rows.length - 1].id;
  }
}

/**
 * Incremental: rows touched since the watermark, keyset on (published_at, id) so the plan rides
 * idx_videos_longtail_watch. `publishedFrom` bounds the scan the way embed-videos does — without it
 * an updated_at predicate has no index and the statement times out at 45 s.
 */
async function* incrementalPages(publishedFrom: Date, updatedSince: Date): AsyncGenerator<Row[]> {
  let cursorPublished: Date | null = null;
  let cursorId = '';
  for (;;) {
    const { rows }: { rows: Row[] } = await db().query<Row>(
      `${ROW_SELECT}
        where v.published_at >= $1
          and ${LONGFORM_PREDICATE}
          and ($2::timestamptz is null or (v.published_at, v.id) > ($2::timestamptz, $3))
          and (v.updated_at >= $4 or v.published_at >= $4)
        order by v.published_at, v.id
        limit $5`,
      [publishedFrom, cursorPublished, cursorId, updatedSince, PAGE],
    );
    if (!rows.length) return;
    yield rows;
    if (rows.length < PAGE) return;
    cursorPublished = rows[rows.length - 1].published_at;
    cursorId = rows[rows.length - 1].id;
  }
}

async function ensureCollection(name: string): Promise<void> {
  const baseUrl = (process.env.QDRANT_URL ?? '').replace(/\/$/, '');
  const existing = await fetch(`${baseUrl}/collections/${name}`);
  if (existing.status !== 404) { if (!existing.ok) throw new Error(`inspect ${name}: HTTP ${existing.status}`); return; }
  const created = await fetch(`${baseUrl}/collections/${name}?wait=true`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ vectors: { size: EMBEDDING_DIMS, distance: 'Cosine', on_disk: true }, on_disk_payload: true }),
  });
  if (!created.ok) throw new Error(`create ${name}: HTTP ${created.status}`);
  const indexed = await fetch(`${baseUrl}/collections/${name}/index?wait=true`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ field_name: 'channel_id', field_schema: 'keyword' }),
  });
  if (!indexed.ok) throw new Error(`index ${name}.channel_id: HTTP ${indexed.status}`);
}

export interface EmbedCatalogOptions {
  /** Absolute floor on published_at (backfill windowing). */
  since?: string | Date | null;
  /** Incremental gate: rows whose updated_at OR published_at is at or after this instant. */
  updatedSince?: Date | null;
  /** Published-at floor for the incremental scan (index-backed bound). Defaults to 30 days back. */
  publishedFrom?: Date;
  write?: boolean;
  maxUsd?: number;
  /** Cap on rows scanned in one run; the run stops at the first page boundary past it. */
  limit?: number | null;
  /** Per-page progress lines (on for the backfill, off for the hourly sync). */
  verbose?: boolean;
}

export interface EmbedCatalogResult {
  scanned: number; current: number; pending: number; embedded: number;
  tokens: number; est_usd: number; actual_usd: number; bytes_read: number;
  /** Channels that received at least one new or changed point — what identity needs rebuilding. */
  channel_ids: string[];
}

export async function embedCatalog(options: EmbedCatalogOptions = {}): Promise<EmbedCatalogResult> {
  const write = options.write ?? false;
  const maxUsd = options.maxUsd ?? 10;
  const limit = options.limit ?? null;
  const qdrant = new SemanticQdrant({ timeoutMs: 60_000 });
  await ensureCollection(CATALOG_COLLECTION);

  const totals = { scanned: 0, current: 0, pending: 0, embedded: 0, tokens: 0, est_usd: 0, actual_usd: 0, bytes_read: 0 };
  const touched = new Set<string>();
  const started = Date.now();
  const source = options.updatedSince
    ? incrementalPages(options.publishedFrom ?? new Date(Date.now() - 30 * 86_400_000), options.updatedSince)
    : pages(options.since ?? null);
  outer: for await (const rows of source) {
    totals.scanned += rows.length;
    for (const r of rows) totals.bytes_read += (r.title?.length ?? 0) + (r.description?.length ?? 0) + 60;
    const prepared = rows.map(prepare);
    const existing = await qdrant.points<{ document_hash?: string; entity_id?: string }>(CATALOG_COLLECTION, prepared.map((p) => p.id));
    const storedHashes = new Map(existing.map((p) => [p.payload?.entity_id, p.payload?.document_hash]));
    const pending = pendingPoints(prepared, storedHashes);
    for (const id of channelIdsOf(pending)) touched.add(id);
    totals.current += prepared.length - pending.length;
    totals.pending += pending.length;
    const estimate = estimateEmbeddingRun(pending.map((p) => p.document));
    totals.tokens += estimate.tokens;
    totals.est_usd += estimate.est_usd;
    if (totals.est_usd > maxUsd) throw new Error(`estimated cost $${totals.est_usd.toFixed(2)} exceeded --max-usd $${maxUsd}`);
    if (write) {
      for (const batch of chunks(pending, EMBED_BATCH)) {
        const vectors = await embedTexts(batch.map((p) => p.document), { onUsage: (_t, usd) => { totals.actual_usd += usd; } });
        if (totals.actual_usd > maxUsd) throw new Error(`actual cost $${totals.actual_usd.toFixed(2)} exceeded --max-usd $${maxUsd}`);
        await qdrant.upsert(CATALOG_COLLECTION, batch.map((p, i) => ({ id: uuid5ForId(p.id), vector: vectors[i], payload: p.payload })));
        totals.embedded += batch.length;
      }
    }
    if (options.verbose) {
      const mins = ((Date.now() - started) / 60_000).toFixed(1);
      console.log(JSON.stringify({ t_min: mins, ...totals, mb_read: +(totals.bytes_read / 1e6).toFixed(1) }));
    }
    if (limit != null && totals.scanned >= limit) break outer;
  }
  return { ...totals, channel_ids: [...touched] };
}

/** Bounded incremental pass for the hourly sync: everything published or updated since `since`. */
export function embedCatalogSince(
  since: Date,
  options: Omit<EmbedCatalogOptions, 'since' | 'updatedSince'> = {},
): Promise<EmbedCatalogResult> {
  return embedCatalog({ ...options, since: null, updatedSince: since });
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const result = await embedCatalog({
    write,
    maxUsd: floatArg(process.argv, '--max-usd') ?? 10,
    limit: intArg(process.argv, '--limit'),
    since: argValue(process.argv, '--since'),
    verbose: true,
  });
  const qdrant = new SemanticQdrant({ timeoutMs: 60_000 });
  console.log(JSON.stringify({
    mode: write ? 'write' : 'dry-run', collection: CATALOG_COLLECTION, model: EMBEDDING_MODEL, dims: EMBEDDING_DIMS,
    ...result, channel_ids: result.channel_ids.length, mb_read: +(result.bytes_read / 1e6).toFixed(1),
    qdrant_count: write ? await qdrant.count(CATALOG_COLLECTION) : undefined,
    semantic_cost_today: await costToday(),
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(main);
