import {
  buildVideoDocument,
  docHash,
  EMBEDDING_DIMS,
  mapVideoPayload,
  VideoDocumentVariant,
  VideoPayloadRow,
} from '../../lib/semantic/documents';
import { embedTexts } from '../../lib/semantic/embed';
import { SemanticQdrant, uuid5ForId, VIDEOS_COLLECTION } from '../../lib/semantic/qdrant';
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

interface VideoRow extends VideoPayloadRow {
  description: string | null;
  updated_at: Date;
}

interface PreparedVideo { row: VideoRow; document: string; hash: string }

const VIDEO_SELECT = `
  select v.id, v.channel_id, coalesce(v.channel_name, v.channel_id) as channel_name,
         v.title, v.description, v.published_at, v.updated_at, v.view_count,
         v.topic_domain, v.topic_niche, v.topic_micro, v.format_type,
         s.score, s.confidence, s.est30, s.baseline
    from videos v
    left join video_scores s on s.video_id = v.id`;

export interface EmbedVideosOptions {
  since: Date;
  limit: number | null;
  dry: boolean;
  variant: VideoDocumentVariant;
  dimensions: number;
  updatedSince?: Date;
  collection?: string;
}

export async function embedVideos(options: EmbedVideosOptions): Promise<{ sqlCount: number; embedded: number; qdrantCount: number | null }> {
  const qdrant = new SemanticQdrant();
  const collection = options.collection ?? VIDEOS_COLLECTION;
  const countResult = await db().query<{ count: string }>(
    `select count(*)::bigint as count from videos
      where published_at > $1 and coalesce(is_short, false) = false and duration <> 'P0D'`,
    [options.since],
  );
  const sqlCount = Number(countResult.rows[0].count);
  let cursorPublished: Date | null = null;
  let cursorId = '';
  let selected = 0;
  let embedded = 0;

  while (options.limit == null || selected < options.limit) {
    const pageLimit = Math.min(READ_BATCH_SIZE, options.limit == null ? READ_BATCH_SIZE : options.limit - selected);
    const result = await db().query<VideoRow>(
      `${VIDEO_SELECT}
        where v.published_at > $1
          and coalesce(v.is_short, false) = false and v.duration <> 'P0D'
          and ($2::timestamptz is null or (v.published_at, v.id) > ($2::timestamptz, $3))
          and ($4::timestamptz is null or v.updated_at >= $4 or v.published_at >= $4)
        order by v.published_at, v.id
        limit $5`,
      [options.since, cursorPublished, cursorId, options.updatedSince ?? null, pageLimit],
    );
    if (!result.rows.length) break;
    selected += result.rows.length;
    const hashes = await currentHashes('video', result.rows.map((row) => row.id));
    const prepared: PreparedVideo[] = result.rows.map((row) => {
      const document = buildVideoDocument({
        title: row.title,
        channelName: row.channel_name,
        topicNiche: row.topic_niche,
        description: row.description,
      }, options.variant);
      return { row, document, hash: docHash(document) };
    }).filter((item) => hashes.get(item.row.id) !== item.hash);

    if (options.dry) {
      embedded += prepared.length;
    } else {
      for (const batch of chunks(prepared, QDRANT_BATCH_SIZE)) {
        const vectors = await embedTexts(batch.map((item) => item.document), { dimensions: options.dimensions });
        const embeddedAt = new Date().toISOString();
        await qdrant.upsert(collection, batch.map((item, index) => ({
          id: uuid5ForId(item.row.id),
          vector: vectors[index],
          payload: mapVideoPayload(item.row, embeddedAt),
        })));
        await recordEmbeddings('video', batch.map((item) => ({ id: item.row.id, hash: item.hash })), options.dimensions);
        embedded += batch.length;
      }
    }

    const last = result.rows[result.rows.length - 1];
    cursorPublished = last.published_at;
    cursorId = last.id;
    console.log(`videos: scanned=${selected} changed=${embedded}`);
    if (result.rows.length < pageLimit) break;
  }

  const qdrantCount = options.dry ? null : await qdrant.count(collection);
  return { sqlCount, embedded, qdrantCount };
}

function cliOptions(argv: string[]): EmbedVideosOptions {
  const variant = (argValue(argv, '--variant') ?? 'default') as VideoDocumentVariant;
  if (!['title', 'default', 'description'].includes(variant)) throw new Error('Invalid --variant');
  return {
    since: sinceDate(argValue(argv, '--since') ?? '30d'),
    limit: intArg(argv, '--limit'),
    dry: argv.includes('--dry'),
    variant,
    dimensions: intArg(argv, '--dimensions') ?? EMBEDDING_DIMS,
    updatedSince: argValue(argv, '--updated-since') ? sinceDate(argValue(argv, '--updated-since') as string) : undefined,
    collection: argValue(argv, '--collection') ?? undefined,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMain(async () => {
    const options = cliOptions(process.argv.slice(2));
    const started = Date.now();
    const report = await embedVideos(options);
    const cost = await costToday();
    console.log(JSON.stringify({
      entity: 'videos', dry: options.dry, ...report,
      coverage_pct: report.qdrantCount == null ? null : Number((100 * report.qdrantCount / report.sqlCount).toFixed(2)),
      wall_seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      cost_today: cost,
    }));
  });
}
