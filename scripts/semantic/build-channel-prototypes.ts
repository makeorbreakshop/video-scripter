import { CHANNELS_COLLECTION, SemanticQdrant, uuid5ForId, VIDEOS_COLLECTION } from '../../lib/semantic/qdrant';
import { chunks, db, QDRANT_BATCH_SIZE, runMain, sinceDate } from './common';
import { chooseMedoids } from '../../lib/semantic/medoids';

export const CHANNEL_MEAN_COLLECTION = 'channels_mean_v1';
export const CHANNEL_BREAKOUT_COLLECTION = 'channels_breakout_v1';

interface ChannelPayload {
  channel_id: string;
  name: string;
  subscriber_count: number | null;
  video_count: number;
  top_niches: string[];
  baseline: number | null;
  outlier_rate: number;
  lane: 'user' | 'corpus';
}

interface VideoPayload {
  video_id: string;
  channel_id: string;
  title: string;
  score: number | null;
  view_count: number;
  published_at: number;
}

interface VideosV2Payload extends VideoPayload {
  facet_model?: string;
}

interface ChannelAccumulator {
  sum: number[];
  count: number;
  breakout: { vector: number[]; payload: VideoPayload } | null;
}

async function ensureCollection(name: string): Promise<void> {
  const baseUrl = (process.env.QDRANT_URL ?? 'http://localhost:6333').replace(/\/$/, '');
  const headers = {
    'content-type': 'application/json',
    ...(process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {}),
  };
  const existing = await fetch(`${baseUrl}/collections/${name}`, { headers });
  if (existing.status === 404) {
    const created = await fetch(`${baseUrl}/collections/${name}?wait=true`, {
      method: 'PUT', headers, body: JSON.stringify({ vectors: { size: 512, distance: 'Cosine' }, on_disk_payload: true }),
    });
    if (!created.ok) throw new Error(`Unable to create ${name}: HTTP ${created.status}`);
  } else if (!existing.ok) {
    throw new Error(`Unable to inspect ${name}: HTTP ${existing.status}`);
  }
}

export async function buildChannelPrototypes(): Promise<void> {
  const qdrant = new SemanticQdrant({ timeoutMs: 30_000 });
  await Promise.all([ensureCollection(CHANNEL_MEAN_COLLECTION), ensureCollection(CHANNEL_BREAKOUT_COLLECTION)]);

  const channels = new Map<string, ChannelPayload>();
  let offset: string | number | undefined;
  do {
    const page = await qdrant.scroll<ChannelPayload>(CHANNELS_COLLECTION, { limit: 1_000, offset });
    for (const point of page.points) channels.set(point.payload.channel_id, point.payload);
    offset = page.nextPageOffset;
  } while (offset != null);

  const accumulators = new Map<string, ChannelAccumulator>();
  offset = undefined;
  const windowStart = Math.floor(sinceDate('30d').getTime() / 1_000);
  do {
    const page: { points: Array<{ vector?: number[] | Record<string, number[]>; payload: VideoPayload }>; nextPageOffset?: string | number } = await qdrant.scroll<VideoPayload>(VIDEOS_COLLECTION, {
      limit: 1_000,
      offset,
      withVector: true,
      filter: { must: [{ key: 'published_at', range: { gte: windowStart } }] },
    });
    for (const point of page.points) {
      if (!Array.isArray(point.vector) || !channels.has(point.payload.channel_id)) continue;
      const vector: number[] = point.vector;
      const current: ChannelAccumulator = accumulators.get(point.payload.channel_id) ?? { sum: Array(vector.length).fill(0) as number[], count: 0, breakout: null };
      vector.forEach((value: number, index: number) => { current.sum[index] += value; });
      current.count += 1;
      const currentScore = current.breakout?.payload.score ?? Number.NEGATIVE_INFINITY;
      const candidateScore = point.payload.score ?? Number.NEGATIVE_INFINITY;
      if (!current.breakout || candidateScore > currentScore
        || (candidateScore === currentScore && point.payload.view_count > current.breakout.payload.view_count)) {
        current.breakout = { vector, payload: point.payload };
      }
      accumulators.set(point.payload.channel_id, current);
    }
    offset = page.nextPageOffset;
  } while (offset != null);

  const meanPoints = [];
  const breakoutPoints = [];
  for (const [channelId, value] of accumulators) {
    const channel = channels.get(channelId);
    if (!channel || !value.breakout) continue;
    meanPoints.push({
      id: uuid5ForId(channelId),
      vector: value.sum.map((component) => component / value.count),
      payload: { ...channel, representation: 'mean_video_vectors', prototype_count: value.count },
    });
    breakoutPoints.push({
      id: uuid5ForId(channelId),
      vector: value.breakout.vector,
      payload: {
        ...channel,
        representation: 'breakout_video_prototype',
        prototype_video_id: value.breakout.payload.video_id,
        prototype_title: value.breakout.payload.title,
      },
    });
  }

  for (const batch of chunks(meanPoints, QDRANT_BATCH_SIZE)) await qdrant.upsert(CHANNEL_MEAN_COLLECTION, batch);
  for (const batch of chunks(breakoutPoints, QDRANT_BATCH_SIZE)) await qdrant.upsert(CHANNEL_BREAKOUT_COLLECTION, batch);
  console.log(JSON.stringify({ channels: channels.size, means: meanPoints.length, breakouts: breakoutPoints.length }));
}

function vectorNamed(pointVector: number[] | Record<string, number[]> | undefined, name: string): number[] | null {
  if (!pointVector || Array.isArray(pointVector)) return null;
  return pointVector[name] ?? null;
}

export async function buildChannelMedoidsV2(): Promise<void> {
  const qdrant = new SemanticQdrant({ timeoutMs: 30_000 });
  const byChannel = new Map<string, { topic: Array<{ id: string; vector: number[]; publishedAt: Date }>; purpose: Array<{ id: string; vector: number[]; publishedAt: Date }> }>();
  let offset: string | number | undefined;
  do {
    const page = await qdrant.scroll<VideosV2Payload>('videos_v2', { limit: 1_000, offset, withVector: true });
    for (const point of page.points) {
      const publishedAt = new Date(point.payload.published_at * 1_000);
      const current = byChannel.get(point.payload.channel_id) ?? { topic: [], purpose: [] };
      const title = vectorNamed(point.vector, 'title');
      const purpose = vectorNamed(point.vector, 'purpose');
      if (title) current.topic.push({ id: point.payload.video_id, vector: title, publishedAt });
      if (purpose) current.purpose.push({ id: point.payload.video_id, vector: purpose, publishedAt });
      byChannel.set(point.payload.channel_id, current);
    }
    offset = page.nextPageOffset;
  } while (offset != null);

  const rows: Array<{ channelId: string; kind: 'topic' | 'purpose'; videoId: string; importance: number; clusterSize: number }> = [];
  for (const [channelId, groups] of byChannel) {
    for (const medoid of chooseMedoids(groups.topic, { maxMedoids: 8 })) {
      rows.push({ channelId, kind: 'topic', videoId: medoid.id, importance: medoid.importance, clusterSize: medoid.clusterSize });
    }
    for (const medoid of chooseMedoids(groups.purpose, { maxMedoids: 8 })) {
      rows.push({ channelId, kind: 'purpose', videoId: medoid.id, importance: medoid.importance, clusterSize: medoid.clusterSize });
    }
  }
  if (rows.length) {
    await db().query(
      `insert into channel_prototypes (channel_id, kind, video_id, importance, cluster_size, built_at)
       select input.channel_id, input.kind, input.video_id, input.importance, input.cluster_size, now()
         from unnest($1::text[], $2::text[], $3::text[], $4::double precision[], $5::int[])
              as input(channel_id, kind, video_id, importance, cluster_size)
       on conflict (channel_id, kind, video_id) do update
         set importance = excluded.importance,
             cluster_size = excluded.cluster_size,
             built_at = excluded.built_at`,
      [
        rows.map((row) => row.channelId),
        rows.map((row) => row.kind),
        rows.map((row) => row.videoId),
        rows.map((row) => row.importance),
        rows.map((row) => row.clusterSize),
      ],
    );
  }
  console.log(JSON.stringify({ collection: 'videos_v2', channels: byChannel.size, prototypes: rows.length }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMain(process.argv.includes('--v2') ? buildChannelMedoidsV2 : buildChannelPrototypes);
}
