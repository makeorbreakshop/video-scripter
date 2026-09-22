// Niche neighborhood of one channel, read from the identity collection and bucketed by that
// channel's own score spread (see channel-buckets.ts). Search always uses the `mean` vector; the
// medoid is carried along only as a human-readable label for what a channel is.
import { BucketThresholds, channelBuckets } from './channel-buckets';
import { QdrantUnavailableError, uuid5ForId } from './qdrant';

export const IDENTITY_COLLECTION = 'channels_identity_v1';

export interface RelatedChannel {
  channel_id: string;
  channel_name: string;
  score: number;
  medoid_title: string | null;
  /**
   * How much this channel looks like the channels ChannelSmith's users track — see
   * scripts/semantic/creator-likeness.ts. null when the point predates that script.
   */
  creator_likeness: number | null;
}

export interface ChannelRelations {
  thresholds: BucketThresholds;
  near: RelatedChannel[];
  adjacent: RelatedChannel[];
  /**
   * The ranked far band, still in similarity order. Carried rather than counted because "far"
   * on /app/angles is a distance band you walk outwards through — closest-first — not the rest
   * of the world; a consumer that only wants the size still has far_count.
   */
  far: RelatedChannel[];
  far_count: number;
}

interface IdentityPayload {
  channel_id?: string;
  channel_name?: string;
  medoid_title?: string;
  creator_likeness?: number;
}

export async function channelRelations(
  channelId: string,
  options: { limit?: number; url?: string; timeoutMs?: number } = {},
): Promise<ChannelRelations> {
  const limit = options.limit ?? 2_000;
  const baseUrl = (options.url ?? process.env.QDRANT_URL ?? 'http://localhost:6333').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/collections/${IDENTITY_COLLECTION}/points/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {}),
    },
    body: JSON.stringify({ query: uuid5ForId(channelId), using: 'mean', limit, with_payload: true }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });
  if (!response.ok) throw new QdrantUnavailableError(`identity query: HTTP ${response.status}`);
  const body = await response.json() as { result: { points: Array<{ score: number; payload: IdentityPayload }> } };

  const neighbors: RelatedChannel[] = body.result.points
    .filter((point) => point.payload?.channel_id && point.payload.channel_id !== channelId)
    .map((point) => ({
      channel_id: point.payload.channel_id as string,
      channel_name: point.payload.channel_name ?? (point.payload.channel_id as string),
      score: point.score,
      medoid_title: point.payload.medoid_title ?? null,
      creator_likeness: typeof point.payload.creator_likeness === 'number' ? point.payload.creator_likeness : null,
    }));

  const { thresholds, near, adjacent, far } = channelBuckets(neighbors);
  return { thresholds, near, adjacent, far, far_count: far.length };
}
