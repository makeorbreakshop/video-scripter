import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { mapVideoPayload, VideoPayloadRow } from '../../lib/semantic/documents';
import { SemanticQdrant, VIDEOS_COLLECTION } from '../../lib/semantic/qdrant';
import { embedChannels } from './embed-channels';
import { embedVideos } from './embed-videos';
import { chunks, db, QDRANT_BATCH_SIZE, READ_BATCH_SIZE, runMain, sinceDate } from './common';

interface ScoreRefreshRow extends VideoPayloadRow {
  scored_at: Date;
}

const statePath = process.env.SEMANTIC_SYNC_STATE_PATH
  ?? path.join(os.homedir(), 'qdrant', 'channelsmith', 'sync-watermark');

async function readWatermark(fallback: Date): Promise<Date> {
  try {
    const value = new Date((await fs.readFile(statePath, 'utf8')).trim());
    return Number.isNaN(value.getTime()) ? fallback : value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeWatermark(value: Date): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, value.toISOString(), { mode: 0o600 });
  await fs.rename(temporary, statePath);
}

async function refreshVideoPayloads(since: Date): Promise<number> {
  const qdrant = new SemanticQdrant();
  let cursorScoredAt: Date | null = null;
  let cursorId = '';
  let refreshed = 0;
  while (true) {
    const result = await db().query<ScoreRefreshRow>(
      `select v.id, v.channel_id, coalesce(v.channel_name, v.channel_id) as channel_name,
              v.title, v.published_at, v.view_count, v.topic_domain, v.topic_niche,
              v.topic_micro, v.format_type, s.score, s.confidence, s.est30, s.baseline, s.scored_at
         from video_scores s
         join embeddings_v1 e on e.entity = 'video' and e.id = s.video_id
         join videos v on v.id = s.video_id
        where s.scored_at >= $1
          and ($2::timestamptz is null or (s.scored_at, s.video_id) > ($2::timestamptz, $3))
        order by s.scored_at, s.video_id
        limit $4`,
      [since, cursorScoredAt, cursorId, READ_BATCH_SIZE],
    );
    const rows = result.rows as ScoreRefreshRow[];
    if (!rows.length) break;
    for (const batch of chunks<ScoreRefreshRow>(rows, QDRANT_BATCH_SIZE)) {
      await qdrant.updatePayloads(VIDEOS_COLLECTION, batch.map((row) => {
        const payload = mapVideoPayload(row);
        return {
          id: row.id,
          payload: {
            view_count: payload.view_count,
            score: payload.score,
            confidence: payload.confidence,
            est30: payload.est30,
            baseline: payload.baseline,
            is_outlier: payload.is_outlier,
          },
        };
      }));
      refreshed += batch.length;
    }
    const last = rows[rows.length - 1];
    cursorScoredAt = last.scored_at;
    cursorId = last.id;
    if (rows.length < READ_BATCH_SIZE) break;
  }
  return refreshed;
}

export async function syncSemantic(options: { dry?: boolean } = {}): Promise<void> {
  const acquired = await db().query<{ acquired: boolean }>(
    `select pg_try_advisory_lock(hashtext('channelsmith-semantic-sync')) as acquired`,
  );
  if (!acquired.rows[0].acquired) {
    console.log('semantic sync already running; skipped');
    return;
  }

  const startedAt = new Date();
  const windowStart = sinceDate('30d');
  const watermark = await readWatermark(windowStart);
  const changedSince = new Date(Math.max(windowStart.getTime(), watermark.getTime() - 5 * 60_000));
  try {
    const videos = await embedVideos({
      since: windowStart, limit: null, dry: !!options.dry, variant: 'default', dimensions: 512, updatedSince: changedSince,
    });
    const channels = await embedChannels({
      since: windowStart, limit: null, dry: !!options.dry, includeNiches: true, dimensions: 512,
      updatedSince: changedSince, refreshPayloads: true,
    });
    const payloadsRefreshed = options.dry ? 0 : await refreshVideoPayloads(new Date(Date.now() - 60 * 60_000));
    if (!options.dry) await writeWatermark(startedAt);
    console.log(JSON.stringify({ status: 'ok', dry: !!options.dry, changed_since: changedSince.toISOString(), videos, channels, payloads_refreshed: payloadsRefreshed }));
  } finally {
    await db().query(`select pg_advisory_unlock(hashtext('channelsmith-semantic-sync'))`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMain(() => syncSemantic({ dry: process.argv.includes('--dry') }));
}
