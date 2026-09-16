// Channel identity vectors from the long-form catalog (videos_catalog_v1), not from top-20 titles and
// not from outliers. Two named vectors per channel:
//   mean   — score-down-weighted mean of the channel's recent catalog (an outlier at 5x counts 1/5)
//   medoid — the one real video closest to all the others; robust to outliers by construction and
//            human-readable ("this channel is basically <title>")
// Reads only local Qdrant plus two tiny server-side aggregates from Postgres (channel list, names).
//
// Usage: npx tsx scripts/semantic/build-channel-identity.ts [--write] [--limit N] [--min-videos 8]
//        npx tsx scripts/semantic/build-channel-identity.ts --probe UCxxxx [--k 25]
import { EMBEDDING_DIMS } from '../../lib/semantic/documents';
import { SemanticQdrant, uuid5ForId } from '../../lib/semantic/qdrant';
import { argValue, chunks, db, intArg, runMain } from './common';
import { CATALOG_COLLECTION } from './embed-catalog';

export const IDENTITY_COLLECTION = 'channels_identity_v1';
const GUARDED_COLLECTION = 'videos_guarded_v1';
const WINDOW_DAYS = 365;
const FALLBACK_LAST_N = 50;
const MAX_PER_CHANNEL = 400;

interface CatalogPayload { video_id: string; channel_id: string; channel_name: string; title: string; published_at: number }
interface Vid { id: string; title: string; publishedAt: number; vector: number[]; weight: number }

// --- pure math -------------------------------------------------------------------------------

export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

/** Weight against inclusion: baseline videos count fully, an outlier at k× counts 1/k. */
export function outlierWeight(score: number | undefined): number {
  if (score == null || !Number.isFinite(score) || score < 2) return 1;
  return 1 / score;
}

export function weightedMean(vids: Vid[]): number[] {
  const acc = new Array<number>(vids[0].vector.length).fill(0);
  let total = 0;
  for (const v of vids) {
    for (let i = 0; i < acc.length; i += 1) acc[i] += v.vector[i] * v.weight;
    total += v.weight;
  }
  return normalize(acc.map((x) => x / (total || 1)));
}

/** Medoid: the member with the highest weighted similarity to every other member. */
export function medoid(vids: Vid[]): Vid {
  const unit = vids.map((v) => normalize(v.vector));
  let best = 0; let bestScore = -Infinity;
  for (let i = 0; i < vids.length; i += 1) {
    let s = 0;
    for (let j = 0; j < vids.length; j += 1) if (i !== j) s += dot(unit[i], unit[j]) * vids[j].weight;
    if (s > bestScore) { bestScore = s; best = i; }
  }
  return vids[best];
}

/** Recent catalog: the last 365 days, or the last N videos when the year is thin. */
export function selectRecent(vids: Vid[], nowSec: number, windowDays = WINDOW_DAYS, fallbackN = FALLBACK_LAST_N): Vid[] {
  const sorted = [...vids].sort((a, b) => b.publishedAt - a.publishedAt);
  const cutoff = nowSec - windowDays * 86_400;
  const recent = sorted.filter((v) => v.publishedAt >= cutoff);
  return (recent.length >= fallbackN ? recent : sorted.slice(0, fallbackN)).slice(0, MAX_PER_CHANNEL);
}

// --- io --------------------------------------------------------------------------------------

async function ensureCollection(): Promise<void> {
  const baseUrl = (process.env.QDRANT_URL ?? '').replace(/\/$/, '');
  const existing = await fetch(`${baseUrl}/collections/${IDENTITY_COLLECTION}`);
  if (existing.status !== 404) { if (!existing.ok) throw new Error(`inspect: HTTP ${existing.status}`); return; }
  const created = await fetch(`${baseUrl}/collections/${IDENTITY_COLLECTION}?wait=true`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ vectors: {
      mean: { size: EMBEDDING_DIMS, distance: 'Cosine' },
      medoid: { size: EMBEDDING_DIMS, distance: 'Cosine' },
    } }),
  });
  if (!created.ok) throw new Error(`create: HTTP ${created.status}`);
}

async function guardedScores(qdrant: SemanticQdrant): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  let offset: string | number | undefined;
  do {
    const page = await qdrant.scroll<{ video_id?: string; score?: number }>(GUARDED_COLLECTION, { limit: 5_000, offset });
    for (const p of page.points) if (p.payload.video_id && p.payload.score != null) scores.set(p.payload.video_id, Number(p.payload.score));
    offset = page.nextPageOffset;
  } while (offset != null);
  return scores;
}

async function channelVideos(qdrant: SemanticQdrant, channelId: string, scores: Map<string, number>): Promise<Vid[]> {
  const out: Vid[] = [];
  let offset: string | number | undefined;
  do {
    const page = await qdrant.scroll<CatalogPayload>(CATALOG_COLLECTION, {
      limit: 1_000, offset, withVector: true,
      filter: { must: [{ key: 'channel_id', match: { value: channelId } }] },
    });
    for (const p of page.points) {
      const vector = Array.isArray(p.vector) ? p.vector : null;
      if (!vector) continue;
      out.push({ id: p.payload.video_id, title: p.payload.title, publishedAt: p.payload.published_at, vector, weight: outlierWeight(scores.get(p.payload.video_id)) });
    }
    offset = page.nextPageOffset;
  } while (offset != null);
  return out;
}

async function channelNames(channelIds: string[]): Promise<Map<string, string>> {
  if (!channelIds.length) return new Map();
  const { rows } = await db().query<{ channel_id: string; name: string }>(
    `select v.channel_id, coalesce(cm.title, max(v.channel_name), v.channel_id) as name
       from videos v left join channel_meta cm on cm.channel_id = v.channel_id
      where v.channel_id = any($1::text[])
      group by v.channel_id, cm.title`,
    [channelIds],
  );
  return new Map(rows.map((r) => [r.channel_id, r.name]));
}

export interface BuildIdentityOptions {
  write?: boolean;
  minVideos?: number;
  qdrant?: SemanticQdrant;
  /** Preloaded guarded outlier scores; loaded once here when omitted. */
  scores?: Map<string, number>;
  names?: Map<string, string>;
  nowSec?: number;
}

/**
 * Rebuild identity vectors for an explicit set of channels. Local compute only: catalog vectors come
 * from Qdrant, and the single Postgres read is a bounded name lookup for these ids.
 */
export async function buildIdentityFor(
  channelIds: string[],
  options: BuildIdentityOptions = {},
): Promise<{ built: number; skipped: number }> {
  if (!channelIds.length) return { built: 0, skipped: 0 };
  const qdrant = options.qdrant ?? new SemanticQdrant({ timeoutMs: 60_000 });
  const write = options.write ?? false;
  const minVideos = options.minVideos ?? 8;
  const scores = options.scores ?? await guardedScores(qdrant);
  const names = options.names ?? await channelNames(channelIds);
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1_000);
  if (write) await ensureCollection();

  let built = 0; let skipped = 0;
  let batch: Array<{ id: string; vector: Record<string, number[]>; payload: Record<string, unknown> }> = [];
  for (const channelId of channelIds) {
    const all = await channelVideos(qdrant, channelId, scores);
    const recent = selectRecent(all, nowSec);
    if (recent.length < minVideos) { skipped += 1; continue; }
    const mean = weightedMean(recent);
    const med = medoid(recent);
    batch.push({
      id: uuid5ForId(channelId),
      vector: { mean, medoid: normalize(med.vector) },
      payload: {
        entity_id: channelId, channel_id: channelId, channel_name: names.get(channelId) ?? channelId,
        n_videos: recent.length, n_catalog: all.length, n_downweighted: recent.filter((v) => v.weight < 1).length,
        medoid_video_id: med.id, medoid_title: med.title,
        window_days: WINDOW_DAYS, built_at: nowSec, recipe: 'catalog-v4-scoreweighted-mean+medoid-v1',
      },
    });
    built += 1;
    if (write && batch.length >= 100) { await qdrant.upsert(IDENTITY_COLLECTION, batch); batch = []; }
  }
  if (write && batch.length) await qdrant.upsert(IDENTITY_COLLECTION, batch);
  return { built, skipped };
}

async function channelList(minVideos: number, limit: number | null): Promise<Array<{ channel_id: string; name: string; n: number }>> {
  // Server-side aggregate: a few thousand small rows, not a table scan returned to the client.
  const { rows } = await db().query<{ channel_id: string; name: string; n: string }>(
    `select v.channel_id, coalesce(cm.title, max(v.channel_name), v.channel_id) as name, count(*)::text as n
       from videos v left join channel_meta cm on cm.channel_id = v.channel_id
      where coalesce(v.is_short,false) = false and coalesce(v.is_institutional,false) = false
      group by v.channel_id, cm.title having count(*) >= $1
      order by count(*) desc ${limit ? 'limit ' + limit : ''}`,
    [minVideos],
  );
  return rows.map((r) => ({ channel_id: r.channel_id, name: r.name, n: Number(r.n) }));
}

async function probe(qdrant: SemanticQdrant, channelId: string, k: number): Promise<void> {
  const baseUrl = (process.env.QDRANT_URL ?? '').replace(/\/$/, '');
  const self = await qdrant.point<Record<string, unknown>>(IDENTITY_COLLECTION, channelId).catch(() => null);
  if (!self) { console.log(`no identity vector for ${channelId}`); return; }
  console.log(`\n== ${self.payload.channel_name}  (n=${self.payload.n_videos}, medoid: "${self.payload.medoid_title}")`);
  for (const using of ['mean', 'medoid'] as const) {
    const res = await fetch(`${baseUrl}/collections/${IDENTITY_COLLECTION}/points/query`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: uuid5ForId(channelId), using, limit: k, with_payload: true }),
    });
    const body = await res.json() as { result: { points: Array<{ score: number; payload: Record<string, unknown> }> } };
    console.log(`\n-- nearest by ${using}`);
    for (const p of body.result.points) console.log(`${p.score.toFixed(3)}  ${p.payload.channel_name}  · ${p.payload.medoid_title}`);
  }
  // A handful of far channels so the low end of the scale is visible too.
  const res = await fetch(`${baseUrl}/collections/${IDENTITY_COLLECTION}/points/query`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: uuid5ForId(channelId), using: 'mean', limit: 2_000, with_payload: true }),
  });
  const all = (await res.json() as { result: { points: Array<{ score: number; payload: Record<string, unknown> }> } }).result.points;
  console.log(`\n-- far tail (of ${all.length} scored)`);
  for (const p of all.slice(-8)) console.log(`${p.score.toFixed(3)}  ${p.payload.channel_name}  · ${p.payload.medoid_title}`);
  const mid = all.slice(Math.floor(all.length * 0.3), Math.floor(all.length * 0.3) + 8);
  console.log(`\n-- 30th percentile band`);
  for (const p of mid) console.log(`${p.score.toFixed(3)}  ${p.payload.channel_name}  · ${p.payload.medoid_title}`);
}

async function main(): Promise<void> {
  const qdrant = new SemanticQdrant({ timeoutMs: 60_000 });
  const probeId = argValue(process.argv, '--probe');
  if (probeId) { await probe(qdrant, probeId, intArg(process.argv, '--k') ?? 25); return; }

  const write = process.argv.includes('--write');
  const minVideos = intArg(process.argv, '--min-videos') ?? 8;
  const limit = intArg(process.argv, '--limit');
  await ensureCollection();
  const scores = await guardedScores(qdrant);
  const channels = await channelList(minVideos, limit);
  console.log(JSON.stringify({ mode: write ? 'write' : 'dry-run', channels: channels.length, guarded_scores: scores.size, min_videos: minVideos }));
  const nowSec = Math.floor(Date.now() / 1_000);
  let built = 0; let skipped = 0; const started = Date.now();
  const names = new Map(channels.map((c) => [c.channel_id, c.name]));
  for (const group of chunks(channels.map((c) => c.channel_id), 500)) {
    const result = await buildIdentityFor(group, { write, minVideos, qdrant, scores, names, nowSec });
    built += result.built; skipped += result.skipped;
    console.log(JSON.stringify({ t_min: ((Date.now() - started) / 60_000).toFixed(1), built, skipped }));
  }
  console.log(JSON.stringify({ mode: write ? 'write' : 'dry-run', built, skipped, count: write ? await qdrant.count(IDENTITY_COLLECTION) : undefined }));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(main);
