// One-time/repair bootstrap for format-2 observation state. Fresh R2 series files are free of
// Supabase history egress. Raw Postgres is a last resort and is impossible without two explicit
// budgets plus a server-side row count that passes before the history query runs.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import { readSeriesFile } from '../lib/readings/series-store';
import { r2Config } from '../lib/readings/archive';
import {
  BOOTSTRAP_CLAIM_SQL, BOOTSTRAP_LATEST_WRITE_SQL, BOOTSTRAP_RAW_COUNT_SQL, BOOTSTRAP_RAW_ROWS_SQL,
  MAX_BOOTSTRAP_RAW_ROWS, MAX_BOOTSTRAP_VIDEOS, bootstrapSource,
  observationStateFromRows, validateRawBootstrapBudget, type BootstrapObservationRow,
} from '../lib/scoring/observation-bootstrap';
import {
  applyObservationChanges, encodeObservationState, observationStateFromSeries,
  observationsFromState, type ObservationChange, type ObservationState,
} from '../lib/scoring/observation-state';
import { OBS_CACHE_V2_UPSERT_SQL } from '../lib/scoring/obs-cache';
import { OBS_DIRTY_CLEAR_SQL, type QueueClaim } from '../lib/scoring/materialization-queue';
import { OBS_CHANGES_DELETE_SQL, OBS_CHANGES_FOR_CLAIMS_SQL } from '../lib/scoring/observation-materializer';

const args = process.argv.slice(2);
const optionalInt = (name: string): number | undefined => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const n = Number(args[i + 1]);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
};
const maxVideos = optionalInt('--max-videos') ?? 25;
const maxChanges = optionalInt('--max-changes') ?? 5_000;
const rawVideoBudget = optionalInt('--raw-video-budget');
const rawRowBudget = optionalInt('--raw-row-budget');
const dryRun = args.includes('--dry-run') || args.includes('--dry');
if (maxVideos > MAX_BOOTSTRAP_VIDEOS) throw new Error(`--max-videos exceeds ${MAX_BOOTSTRAP_VIDEOS}`);
if (maxChanges > 5_000) throw new Error('--max-changes exceeds 5000');
if (rawRowBudget !== undefined && rawRowBudget > MAX_BOOTSTRAP_RAW_ROWS) {
  throw new Error(`--raw-row-budget exceeds hard limit ${MAX_BOOTSTRAP_RAW_ROWS}`);
}

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: 60_000 });
const client = await pool.connect();
try {
  await client.query('begin isolation level repeatable read');
  const claims = (await client.query(BOOTSTRAP_CLAIM_SQL, [maxVideos])).rows.map((row: any) => ({
    videoId: row.video_id as string,
    generation: Number(row.generation),
    publishedAt: new Date(row.published_at).toISOString(),
    captureStartedAt: new Date(row.capture_started_at).toISOString(),
  }));
  const cfg = r2Config();
  const states = new Map<string, ObservationState>();
  const rawIds: string[] = [];
  const latestWrites = new Map<string, string | null>();
  if (claims.length) {
    const rows = (await client.query(BOOTSTRAP_LATEST_WRITE_SQL, [claims.map((claim: any) => claim.videoId)])).rows;
    for (const row of rows) {
      latestWrites.set(row.video_id, row.latest_write_at ? new Date(row.latest_write_at).toISOString() : null);
    }
  }
  for (const claim of claims) {
    const file = cfg ? await readSeriesFile(claim.videoId, cfg) : null;
    if (bootstrapSource(file, claim.captureStartedAt, latestWrites.get(claim.videoId) ?? null) === 'r2') {
      states.set(claim.videoId, observationStateFromSeries(file!, 0));
    } else rawIds.push(claim.videoId);
  }

  if (rawIds.length) {
    const count = Number((await client.query(BOOTSTRAP_RAW_COUNT_SQL, [rawIds])).rows[0]?.n ?? 0);
    validateRawBootstrapBudget({ videos: rawIds.length, rows: count }, { rawVideoBudget, rawRowBudget });
    const rows = (await client.query(BOOTSTRAP_RAW_ROWS_SQL, [rawIds])).rows;
    const byVideo = new Map<string, BootstrapObservationRow[]>();
    for (const row of rows) {
      const group = byVideo.get(row.video_id) ?? [];
      group.push(row);
      byVideo.set(row.video_id, group);
    }
    for (const claim of claims.filter((row: any) => rawIds.includes(row.videoId))) {
      states.set(claim.videoId, observationStateFromRows(
        claim.videoId, claim.publishedAt, byVideo.get(claim.videoId) ?? [], claim.generation,
      ));
    }
  }

  const claimPayload = claims.map((claim: any) => ({
    video_id: claim.videoId, generation: claim.generation, last_change_id: 0,
  }));
  const deltaRows = claims.length
    ? (await client.query(OBS_CHANGES_FOR_CLAIMS_SQL, [JSON.stringify(claimPayload), maxChanges + 1])).rows
    : [];
  if (deltaRows.length > maxChanges) throw new Error(`bootstrap delta count exceeds ${maxChanges}`);
  const changesByVideo = new Map<string, ObservationChange[]>();
  for (const row of deltaRows) {
    const group = changesByVideo.get(row.video_id) ?? [];
    group.push({
      changeId: Number(row.change_id), videoId: row.video_id, source: row.source,
      operation: row.operation, at: new Date(row.at).toISOString(),
      views: row.views === null ? null : Number(row.views), timeBasis: row.time_basis,
      receivedAt: row.received_at ? new Date(row.received_at).toISOString() : null,
      modelEligible: Boolean(row.model_eligible), conflicted: Boolean(row.conflicted),
    });
    changesByVideo.set(row.video_id, group);
  }

  const ready: { claim: QueueClaim; state: ObservationState; obs: Buffer; n: number }[] = [];
  let compressedBytes = 0;
  for (const claim of claims) {
    const seeded = states.get(claim.videoId);
    if (!seeded) throw new Error(`no bootstrap source for ${claim.videoId}`);
    const state = seeded.lastChangeId >= claim.generation
      ? seeded
      : applyObservationChanges(seeded, changesByVideo.get(claim.videoId) ?? []);
    if (state.lastChangeId < claim.generation) throw new Error(`change log gap for ${claim.videoId}`);
    const obs = encodeObservationState(state);
    compressedBytes += obs.length;
    if (compressedBytes > 5_000_000) throw new Error('bootstrap compressed-byte limit exceeded');
    ready.push({ claim: { video_id: claim.videoId, generation: claim.generation }, state, obs, n: observationsFromState(state).length });
  }
  if (ready.length) {
    await client.query(OBS_CACHE_V2_UPSERT_SQL, [
      ready.map((row) => row.claim.video_id), ready.map((row) => row.n), ready.map((row) => row.obs),
      ready.map((row) => row.state.lastChangeId),
    ]);
    await client.query(OBS_CHANGES_DELETE_SQL, [JSON.stringify(ready.map((row) => ({
      video_id: row.claim.video_id, last_change_id: row.state.lastChangeId,
    })))]);
    await client.query(OBS_DIRTY_CLEAR_SQL, [JSON.stringify(ready.map((row) => row.claim))]);
  }
  await client.query(dryRun ? 'rollback' : 'commit');
  console.log(`observation bootstrap${dryRun ? ' [dry run]' : ''}: ${ready.length} videos, `
    + `${rawIds.length} raw, ${ready.length - rawIds.length} R2, ${deltaRows.length} deltas, ${compressedBytes} bytes`);
} catch (error) {
  await client.query('rollback').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
