import { CHANNELS_COLLECTION, SemanticQdrant, uuid5ForId, VIDEOS_COLLECTION } from '../../lib/semantic/qdrant';
import { chunks, QDRANT_BATCH_SIZE, runMain, sinceDate } from './common';

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
    const page = await qdrant.scroll<VideoPayload>(VIDEOS_COLLECTION, {
      limit: 1_000,
      offset,
      withVector: true,
      filter: { must: [{ key: 'published_at', range: { gte: windowStart } }] },
    });
    for (const point of page.points) {
      if (!Array.isArray(point.vector) || !channels.has(point.payload.channel_id)) continue;
      const vector = point.vector;
      const current = accumulators.get(point.payload.channel_id) ?? { sum: Array(vector.length).fill(0), count: 0, breakout: null };
      vector.forEach((value, index) => { current.sum[index] += value; });
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

if (import.meta.url === `file://${process.argv[1]}`) runMain(buildChannelPrototypes);
