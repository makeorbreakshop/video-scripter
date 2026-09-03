import {
  buildChannelDocument,
  ChannelDocumentVideo,
  docHash,
  EMBEDDING_DIMS,
  mapChannelPayload,
  topNiches,
} from '../../lib/semantic/documents';
import { embedTexts } from '../../lib/semantic/embed';
import { CHANNELS_COLLECTION, SemanticQdrant, uuid5ForId } from '../../lib/semantic/qdrant';
import {
  argValue,
  chunks,
  costToday,
  currentHashes,
  db,
  intArg,
  QDRANT_BATCH_SIZE,
  READ_BATCH_SIZE,
  recordEmbeddings,
  runMain,
  sinceDate,
} from './common';

interface ChannelVideoRow {
  id: string;
  channel_id: string;
  channel_name: string | null;
  title: string;
  published_at: Date;
  view_count: number | string | null;
  topic_niche: string | null;
  score: number | string | null;
  baseline: number | string | null;
}

interface ChannelMetaRow {
  channel_id: string;
  title: string | null;
  subscriber_count: number | string | null;
  video_count: number | string | null;
  lane: 'user' | 'corpus';
}

interface PreparedChannel {
  id: string;
  document: string;
  hash: string;
  payload: ReturnType<typeof mapChannelPayload>;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export interface EmbedChannelsOptions {
  since: Date;
  limit: number | null;
  dry: boolean;
  includeNiches: boolean;
  dimensions: number;
  updatedSince?: Date;
  collection?: string;
  refreshPayloads?: boolean;
}

export async function embedChannels(options: EmbedChannelsOptions): Promise<{ sqlCount: number; embedded: number; qdrantCount: number | null }> {
  const idResult = await db().query<{ channel_id: string }>(
    `select distinct v.channel_id
       from videos v
      where v.published_at > $1 and coalesce(v.is_short, false) = false and v.duration <> 'P0D'
        and v.channel_id is not null
        and ($2::timestamptz is null
          or v.updated_at >= $2 or v.published_at >= $2
          or v.channel_id in (select s.channel_id from video_scores s where s.scored_at >= $2)
          or v.channel_id in (select cm.channel_id from channel_meta cm where cm.fetched_at >= $2))
      order by v.channel_id`,
    [options.since, options.updatedSince ?? null],
  );
  const allWindowCount = await db().query<{ count: string }>(
    `select count(distinct channel_id)::bigint as count from videos
      where published_at > $1 and coalesce(is_short, false) = false and duration <> 'P0D'`,
    [options.since],
  );
  const ids: string[] = idResult.rows.map((row) => row.channel_id).slice(0, options.limit ?? undefined);
  const sqlCount = Number(allWindowCount.rows[0].count);
  const qdrant = new SemanticQdrant();
  const collection = options.collection ?? CHANNELS_COLLECTION;
  let embedded = 0;

  for (const idBatch of chunks<string>(ids, Math.min(1_000, READ_BATCH_SIZE))) {
    const videoRows = (await db().query<ChannelVideoRow>(
        `select v.id, v.channel_id, v.channel_name, v.title, v.published_at, v.view_count,
                v.topic_niche, s.score, s.baseline
           from videos v
           left join video_scores s on s.video_id = v.id
          where v.channel_id = any($1::text[]) and v.published_at > $2
            and coalesce(v.is_short, false) = false and v.duration <> 'P0D'
          order by v.channel_id, v.published_at desc`,
        [idBatch, options.since],
      )).rows as ChannelVideoRow[];
    const metaRows = (await db().query<ChannelMetaRow>(
        `select input.channel_id, cm.title, cm.subscriber_count, cm.video_count,
                case when ct.lane = 'user' then 'user' else 'corpus' end as lane
           from unnest($1::text[]) as input(channel_id)
           left join channel_meta cm on cm.channel_id = input.channel_id
           left join channel_tracking ct on ct.channel_id = input.channel_id`,
        [idBatch],
      )).rows as ChannelMetaRow[];
    const videosByChannel = new Map<string, ChannelVideoRow[]>();
    for (const video of videoRows) {
      const list = videosByChannel.get(video.channel_id) ?? [];
      list.push(video);
      videosByChannel.set(video.channel_id, list);
    }
    const metaByChannel = new Map<string, ChannelMetaRow>(metaRows.map((row) => [row.channel_id, row]));
    const hashes = await currentHashes('channel', idBatch);
    const allPrepared: PreparedChannel[] = idBatch.map((id) => {
      const videos = videosByChannel.get(id) ?? [];
      const meta = metaByChannel.get(id);
      const name = meta?.title || videos[0]?.channel_name || id;
      const documentVideos: ChannelDocumentVideo[] = videos.map((video) => ({
        title: video.title,
        viewCount: video.view_count,
        publishedAt: video.published_at,
        topicNiche: video.topic_niche,
      }));
      const document = buildChannelDocument({ name, videos: documentVideos }, { includeNiches: options.includeNiches });
      const scored = videos.filter((video) => video.score != null);
      const baselines = videos.flatMap((video) => video.baseline == null ? [] : [Number(video.baseline)]);
      return {
        id,
        document,
        hash: docHash(document),
        payload: mapChannelPayload({
          channel_id: id,
          name,
          subscriber_count: meta?.subscriber_count ?? null,
          video_count: meta?.video_count ?? videos.length,
          top_niches: topNiches(documentVideos),
          baseline: median(baselines),
          outlier_rate: scored.length ? scored.filter((video) => Number(video.score) >= 2).length / scored.length : 0,
          lane: meta?.lane ?? 'corpus',
        }),
      };
    });
    const prepared = allPrepared.filter((item) => hashes.get(item.id) !== item.hash);

    if (options.dry) {
      embedded += prepared.length;
    } else {
      for (const batch of chunks(prepared, QDRANT_BATCH_SIZE)) {
        const vectors = await embedTexts(batch.map((item) => item.document), { dimensions: options.dimensions });
        await qdrant.upsert(collection, batch.map((item, index) => ({
          id: uuid5ForId(item.id), vector: vectors[index], payload: item.payload,
        })));
        await recordEmbeddings('channel', batch.map((item) => ({ id: item.id, hash: item.hash })), options.dimensions);
        embedded += batch.length;
      }
      if (options.refreshPayloads) {
        const unchanged = allPrepared.filter((item) => hashes.get(item.id) === item.hash);
        for (const batch of chunks(unchanged, QDRANT_BATCH_SIZE)) {
          await qdrant.updatePayloads(collection, batch.map((item) => {
            const { embedded_at: _embeddedAt, ...payload } = item.payload;
            return { id: item.id, payload };
          }));
        }
      }
    }
    console.log(`channels: scanned=${Math.min(ids.length, idBatch.length + ids.indexOf(idBatch[0]))} changed=${embedded}`);
  }

  const qdrantCount = options.dry ? null : await qdrant.count(collection);
  return { sqlCount, embedded, qdrantCount };
}

function cliOptions(argv: string[]): EmbedChannelsOptions {
  const variant = argValue(argv, '--variant') ?? 'niches';
  if (!['titles', 'niches'].includes(variant)) throw new Error('Invalid --variant (use titles or niches)');
  return {
    since: sinceDate(argValue(argv, '--since') ?? '30d'),
    limit: intArg(argv, '--limit'),
    dry: argv.includes('--dry'),
    includeNiches: variant === 'niches',
    dimensions: intArg(argv, '--dimensions') ?? EMBEDDING_DIMS,
    updatedSince: argValue(argv, '--updated-since') ? sinceDate(argValue(argv, '--updated-since') as string) : undefined,
    collection: argValue(argv, '--collection') ?? undefined,
    refreshPayloads: argv.includes('--refresh-payloads'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMain(async () => {
    const options = cliOptions(process.argv.slice(2));
    const started = Date.now();
    const report = await embedChannels(options);
    const cost = await costToday();
    console.log(JSON.stringify({
      entity: 'channels', dry: options.dry, ...report,
      coverage_pct: report.qdrantCount == null ? null : Number((100 * report.qdrantCount / report.sqlCount).toFixed(2)),
      wall_seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      cost_today: cost,
    }));
  });
}
