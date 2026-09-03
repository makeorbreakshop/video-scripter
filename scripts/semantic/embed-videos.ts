import {
  buildVideoDocument,
  docHash,
  EMBEDDING_DIMS,
  mapVideoPayload,
  VideoDocumentVariant,
  VideoPayloadRow,
} from '../../lib/semantic/documents';
import { assertEmbeddingBudget, embedTexts, estimateEmbeddingRun } from '../../lib/semantic/embed';
import { SemanticQdrant, uuid5ForId, VIDEOS_COLLECTION } from '../../lib/semantic/qdrant';
import {
  argValue,
  chunks,
  costToday,
  currentHashes,
  db,
  intArg,
  floatArg,
  QDRANT_BATCH_SIZE,
  READ_BATCH_SIZE,
  recordEmbeddings,
  runMain,
  sinceDate,
} from './common';

interface VideoRow extends VideoPayloadRow {
  description: string | null;
  published_at: Date;
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
  maxUsd?: number;
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
  const toEmbed: PreparedVideo[] = [];

  while (options.limit == null || selected < options.limit) {
    const pageLimit = Math.min(READ_BATCH_SIZE, options.limit == null ? READ_BATCH_SIZE : options.limit - selected);
    const rows = (await db().query<VideoRow>(
      `${VIDEO_SELECT}
        where v.published_at > $1
          and coalesce(v.is_short, false) = false and v.duration <> 'P0D'
          and ($2::timestamptz is null or (v.published_at, v.id) > ($2::timestamptz, $3))
          and ($4::timestamptz is null or v.updated_at >= $4 or v.published_at >= $4)
        order by v.published_at, v.id
        limit $5`,
      [options.since, cursorPublished, cursorId, options.updatedSince ?? null, pageLimit],
    )).rows as VideoRow[];
    if (!rows.length) break;
    selected += rows.length;
    const hashes = await currentHashes('video', rows.map((row) => row.id));
    const prepared: PreparedVideo[] = rows.map((row) => {
      const document = buildVideoDocument({
        title: row.title,
        channelName: row.channel_name,
        topicNiche: row.topic_niche,
        description: row.description,
      }, options.variant);
      return { row, document, hash: docHash(document) };
    }).filter((item) => hashes.get(item.row.id) !== item.hash);

    toEmbed.push(...prepared);

    const last: VideoRow = rows[rows.length - 1];
    cursorPublished = last.published_at;
    cursorId = last.id;
    console.log(`videos: scanned=${selected} changed=${toEmbed.length}`);
    if (rows.length < pageLimit) break;
  }

  const estimate = estimateEmbeddingRun(toEmbed.map((item) => item.document));
  console.log(JSON.stringify({ cost_gate: estimate, max_usd: options.maxUsd ?? 2, price_checked_at: '2026-09-02', price_source: 'https://developers.openai.com/api/docs/models/text-embedding-3-small' }));
  assertEmbeddingBudget(estimate, options.maxUsd ?? 2);
  if (options.dry) {
    embedded = toEmbed.length;
  } else {
    let actualUsd = 0;
    for (const batch of chunks(toEmbed, QDRANT_BATCH_SIZE)) {
      const vectors = await embedTexts(batch.map((item) => item.document), {
        dimensions: options.dimensions,
        onUsage: (_tokens, usd) => { actualUsd += usd; },
      });
      if (estimate.est_usd > 0 && actualUsd > estimate.est_usd * 1.2) {
        throw new Error(`Actual embedding cost exceeded estimate by more than 20% ($${actualUsd.toFixed(6)} actual vs $${estimate.est_usd.toFixed(6)} estimated)`);
      }
      const embeddedAt = new Date().toISOString();
      await qdrant.upsert(collection, batch.map((item, index) => ({
        id: uuid5ForId(item.row.id), vector: vectors[index], payload: mapVideoPayload(item.row, embeddedAt),
      })));
      await recordEmbeddings('video', batch.map((item) => ({ id: item.row.id, hash: item.hash })), options.dimensions);
      embedded += batch.length;
    }
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
    maxUsd: floatArg(argv, '--max-usd') ?? 2,
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
