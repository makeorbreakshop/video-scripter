import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { mapVideoPayload, VideoPayloadRow } from '../../lib/semantic/documents';
import { SemanticQdrant, VIDEOS_COLLECTION } from '../../lib/semantic/qdrant';
import { buildIdentityFor } from './build-channel-identity';
import { embedCatalogSince } from './embed-catalog';
import { embedChannels } from './embed-channels';
import { embedVideos } from './embed-videos';
import { chunks, db, floatArg, QDRANT_BATCH_SIZE, READ_BATCH_SIZE, runMain, sinceDate } from './common';
import {
  ACQUIRE_SQL, acquireOutcome, BREAK_STALE_SQL, HEARTBEAT_MS, HEARTBEAT_SQL, holderId, LEASE_NAME, LEASE_TTL_MS,
  LeaseRow, READ_SQL, RELEASE_SQL,
} from '../../lib/semantic/sync-lease';

// Bounds for the catalog/identity leg of the hourly run. The catalog backfill was a one-time 1.3 GB
// read; the incremental pass must stay small, so cap both the rows it scans and the dollars it spends.
const CATALOG_MAX_ROWS = 20_000;
const CATALOG_MAX_USD = 0.25;
const IDENTITY_MAX_CHANNELS = 2_000;
// In --dry mode the identity leg only exercises a handful of channels: it is pure local compute but a
// full rebuild of every touched channel is minutes of Qdrant scrolling nobody asked for in a dry run.
const DRY_IDENTITY_CHANNELS = 3;

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

async function readLease(): Promise<LeaseRow | null> {
  const result = await db().query<LeaseRow>(READ_SQL, [LEASE_NAME]);
  return result.rows[0] ?? null;
}

/**
 * Takes the run lease or reports who holds it. Every run logs one `lease` line: `lock: acquired`
 * (with `took_over_stale_from` when a dead run's row was displaced) or `lock: skipped` with
 * `held_by`, `held_since` and `expires_at`. `waited_ms` is the time the acquire round-trip took,
 * which is where a pooler queue shows up.
 */
async function acquireLease(holder: string): Promise<boolean> {
  const started = Date.now();
  const before = await readLease();
  const upsert = await db().query<{ holder: string }>(ACQUIRE_SQL, [LEASE_NAME, holder, LEASE_TTL_MS]);
  const acquired = upsert.rows.length > 0;
  const after = acquired ? null : await readLease();
  const outcome = acquireOutcome(before, acquired, after, new Date(), Date.now() - started);
  console.log(JSON.stringify({ lease: LEASE_NAME, holder, ttl_ms: LEASE_TTL_MS, ...outcome }));
  return acquired;
}

/** `--break-stale-lock`: clears the lease only if it is past its TTL. A live lease is left alone. */
export async function breakStaleLock(): Promise<void> {
  const before = await readLease();
  const cleared = await db().query<{ holder: string; acquired_at: Date }>(BREAK_STALE_SQL, [LEASE_NAME]);
  console.log(JSON.stringify({
    lease: LEASE_NAME, action: 'break-stale-lock',
    cleared: cleared.rows[0]
      ? { holder: cleared.rows[0].holder, acquired_at: cleared.rows[0].acquired_at.toISOString() }
      : null,
    kept: cleared.rows.length || !before
      ? null
      : { holder: before.holder, held_since: before.acquired_at.toISOString(), expires_at: before.expires_at.toISOString() },
  }));
}

export async function syncSemantic(options: { dry?: boolean; maxUsd?: number } = {}): Promise<void> {
  const startedAt = new Date();
  const holder = holderId(os.hostname(), process.pid, startedAt);
  if (!(await acquireLease(holder))) return;
  // Keep the lease alive for as long as this process is; if it dies, the row expires on its own.
  const heartbeat = setInterval(() => {
    db().query(HEARTBEAT_SQL, [LEASE_NAME, holder, LEASE_TTL_MS])
      .catch((error) => console.error(`lease heartbeat failed: ${error instanceof Error ? error.message : String(error)}`));
  }, HEARTBEAT_MS);
  heartbeat.unref();

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
    // Catalog + identity: embed anything published or updated since the watermark, then rebuild
    // identity vectors only for the channels that actually received points. The scan is bounded to
    // the same 30-day published window as the rest of the sync because videos.updated_at has no
    // index; a title edit on an older video is picked up by a targeted
    // `embed-catalog.ts --since`, not here.
    const catalogStarted = Date.now();
    const catalog = await embedCatalogSince(changedSince, {
      write: !options.dry, maxUsd: options.maxUsd ?? CATALOG_MAX_USD, limit: CATALOG_MAX_ROWS,
      publishedFrom: windowStart,
    });
    const identityChannels = catalog.channel_ids.slice(0, options.dry ? DRY_IDENTITY_CHANNELS : IDENTITY_MAX_CHANNELS);
    const identity = await buildIdentityFor(identityChannels, { write: !options.dry });
    console.log(JSON.stringify({
      leg: 'catalog', dry: !!options.dry, since: changedSince.toISOString(),
      scanned: catalog.scanned, pending: catalog.pending, embedded: catalog.embedded,
      usd: +catalog.actual_usd.toFixed(6), est_usd: +catalog.est_usd.toFixed(6), tokens: catalog.tokens,
      channels_touched: catalog.channel_ids.length, identity_channels: identityChannels.length,
      identity_built: identity.built, identity_skipped: identity.skipped,
      capped: catalog.scanned >= CATALOG_MAX_ROWS || catalog.channel_ids.length > identityChannels.length,
      t_s: +((Date.now() - catalogStarted) / 1_000).toFixed(1),
    }));

    const payloadsRefreshed = options.dry ? 0 : await refreshVideoPayloads(new Date(Date.now() - 60 * 60_000));
    if (!options.dry) await writeWatermark(startedAt);
    console.log(JSON.stringify({ status: 'ok', dry: !!options.dry, changed_since: changedSince.toISOString(), videos, channels, payloads_refreshed: payloadsRefreshed,
      catalog: {
        scanned: catalog.scanned, pending: catalog.pending, embedded: catalog.embedded,
        usd: +catalog.actual_usd.toFixed(6), est_usd: +catalog.est_usd.toFixed(6),
        channels_touched: catalog.channel_ids.length,
        identity_built: identity.built, identity_skipped: identity.skipped,
      } }));
  } finally {
    clearInterval(heartbeat);
    await db().query(RELEASE_SQL, [LEASE_NAME, holder]);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMain(() => process.argv.includes('--break-stale-lock')
    ? breakStaleLock()
    : syncSemantic({ dry: process.argv.includes('--dry'), maxUsd: floatArg(process.argv, '--max-usd') ?? undefined }));
}
