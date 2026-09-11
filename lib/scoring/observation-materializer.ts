import {
  applyObservationChanges,
  decodeObservationState,
  encodeObservationState,
  observationsFromState,
  type ObservationChange,
  type ObservationState,
} from './observation-state';
import { OBS_CACHE_V2_UPSERT_SQL } from './obs-cache';
import { OBS_DIRTY_CLAIM_SQL, OBS_DIRTY_CLEAR_SQL, type QueueClaim } from './materialization-queue';

export const MATERIALIZER_LIMITS = {
  videos: 100,
  changes: 5_000,
  compressedBytes: 5_000_000,
} as const;

export interface ObservationMaterializationClaim {
  videoId: string;
  generation: number;
  requiresBootstrap: boolean;
  format: number | null;
  lastChangeId: number;
  publishedAt: string | null;
  obs: Buffer | null;
}

export interface MaterializedObservationUpsert {
  videoId: string;
  state: ObservationState;
  obs: Buffer;
  n: number;
  lastChangeId: number;
}

export interface ObservationMaterializationPlan {
  upserts: MaterializedObservationUpsert[];
  completed: QueueClaim[];
  partial: QueueClaim[];
  needsBootstrap: QueueClaim[];
  stats: { videos: number; changes: number; completed: number; partial: number; bootstraps: number; compressedBytes: number };
}

export interface MaterializationLimits {
  maxVideos: number;
  maxChanges: number;
  maxCompressedBytes: number;
  changesTruncated: boolean;
}

const claimKey = (claim: ObservationMaterializationClaim): QueueClaim => ({
  video_id: claim.videoId,
  generation: claim.generation,
});

export function planObservationMaterialization(
  claims: readonly ObservationMaterializationClaim[],
  changes: readonly ObservationChange[],
  limits: MaterializationLimits,
): ObservationMaterializationPlan {
  if (claims.length > limits.maxVideos) throw new Error(`materializer video limit exceeded (${limits.maxVideos})`);
  if (changes.length > limits.maxChanges) throw new Error(`materializer change limit exceeded (${limits.maxChanges})`);
  const byVideo = new Map<string, ObservationChange[]>();
  for (const change of changes) {
    const rows = byVideo.get(change.videoId);
    if (rows) rows.push(change);
    else byVideo.set(change.videoId, [change]);
  }

  const upserts: MaterializedObservationUpsert[] = [];
  const completed: QueueClaim[] = [];
  const partial: QueueClaim[] = [];
  const needsBootstrap: QueueClaim[] = [];
  let compressedBytes = 0;

  for (const claim of claims) {
    const key = claimKey(claim);
    if (claim.requiresBootstrap || claim.format !== 2 || !claim.obs || !claim.publishedAt) {
      needsBootstrap.push(key);
      continue;
    }
    const current = decodeObservationState(claim.obs);
    const relevant = (byVideo.get(claim.videoId) ?? [])
      .filter((change) => change.changeId > claim.lastChangeId && change.changeId <= claim.generation);
    if (!relevant.length && claim.lastChangeId < claim.generation) {
      (limits.changesTruncated ? partial : needsBootstrap).push(key);
      continue;
    }
    const state = applyObservationChanges(current, relevant);
    const obs = encodeObservationState(state);
    compressedBytes += obs.length;
    if (compressedBytes > limits.maxCompressedBytes) {
      throw new Error(`materializer compressed-byte limit exceeded (${limits.maxCompressedBytes})`);
    }
    upserts.push({
      videoId: claim.videoId,
      state,
      obs,
      n: observationsFromState(state).length,
      lastChangeId: state.lastChangeId,
    });
    if (state.lastChangeId >= claim.generation) completed.push(key);
    else if (limits.changesTruncated) partial.push(key);
    else needsBootstrap.push(key);
  }

  return {
    upserts, completed, partial, needsBootstrap,
    stats: {
      videos: claims.length,
      changes: changes.length,
      completed: completed.length,
      partial: partial.length,
      bootstraps: needsBootstrap.length,
      compressedBytes,
    },
  };
}

export const OBS_CHANGES_FOR_CLAIMS_SQL = `
  with claims as (
    select * from jsonb_to_recordset($1::jsonb)
      as x(video_id text, generation bigint, last_change_id bigint)
  )
  select l.change_id::text, l.video_id, l.source, l.operation, l.at, l.views,
         l.time_basis, l.received_at, l.model_eligible, l.conflicted
    from observation_change_log l join claims c using(video_id)
   where l.change_id > c.last_change_id and l.change_id <= c.generation
   order by l.change_id
   limit $2`;

export const OBS_CHANGES_DELETE_SQL = `
  delete from observation_change_log l
  using jsonb_to_recordset($1::jsonb) as x(video_id text, last_change_id bigint)
  where l.video_id=x.video_id and l.change_id <= x.last_change_id`;

export const OBS_DIRTY_REQUIRE_BOOTSTRAP_SQL = `
  update obs_cache_dirty d
     set requires_bootstrap=true, attempts=d.attempts+1,
         not_before=greatest(d.not_before, now() + interval '5 minutes'),
         last_error='v2 source state unavailable or change log incomplete'
    from jsonb_to_recordset($1::jsonb) as x(video_id text, generation bigint)
   where d.video_id=x.video_id and d.generation=x.generation`;

export interface TransactionClient {
  query(sql: string, values?: any[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

const number = (value: unknown): number => Number(value ?? 0);

export async function materializeObservationBatch(
  client: TransactionClient,
  options: { maxVideos: number; maxChanges: number; maxCompressedBytes: number; dryRun?: boolean },
): Promise<ObservationMaterializationPlan> {
  if (options.maxVideos > MATERIALIZER_LIMITS.videos || options.maxChanges > MATERIALIZER_LIMITS.changes
    || options.maxCompressedBytes > MATERIALIZER_LIMITS.compressedBytes) {
    throw new Error('materializer options exceed recurring hard limits');
  }
  await client.query('begin');
  try {
    const claimRows = (await client.query(OBS_DIRTY_CLAIM_SQL, [options.maxVideos])).rows;
    const claims: ObservationMaterializationClaim[] = claimRows.map((row) => ({
      videoId: row.video_id,
      generation: number(row.generation),
      requiresBootstrap: Boolean(row.requires_bootstrap),
      format: row.format === null || row.format === undefined ? null : number(row.format),
      lastChangeId: number(row.last_change_id),
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
      obs: row.obs ? Buffer.from(row.obs) : null,
    }));
    const claimJson = JSON.stringify(claims.map((claim) => ({
      video_id: claim.videoId, generation: claim.generation, last_change_id: claim.lastChangeId,
    })));
    const changeRows = claims.length
      ? (await client.query(OBS_CHANGES_FOR_CLAIMS_SQL, [claimJson, options.maxChanges + 1])).rows
      : [];
    const changesTruncated = changeRows.length > options.maxChanges;
    const changes: ObservationChange[] = changeRows.slice(0, options.maxChanges).map((row) => ({
      changeId: number(row.change_id), videoId: row.video_id, source: row.source,
      operation: row.operation, at: new Date(row.at).toISOString(),
      views: row.views === null ? null : number(row.views), timeBasis: row.time_basis,
      receivedAt: row.received_at ? new Date(row.received_at).toISOString() : null,
      modelEligible: Boolean(row.model_eligible), conflicted: Boolean(row.conflicted),
    }));
    const plan = planObservationMaterialization(claims, changes, {
      ...options, changesTruncated,
    });
    if (plan.upserts.length) {
      await client.query(OBS_CACHE_V2_UPSERT_SQL, [
        plan.upserts.map((row) => row.videoId),
        plan.upserts.map((row) => row.n),
        plan.upserts.map((row) => row.obs),
        plan.upserts.map((row) => row.lastChangeId),
      ]);
      await client.query(OBS_CHANGES_DELETE_SQL, [JSON.stringify(plan.upserts.map((row) => ({
        video_id: row.videoId, last_change_id: row.lastChangeId,
      }))) ]);
    }
    if (plan.completed.length) await client.query(OBS_DIRTY_CLEAR_SQL, [JSON.stringify(plan.completed)]);
    if (plan.needsBootstrap.length) {
      await client.query(OBS_DIRTY_REQUIRE_BOOTSTRAP_SQL, [JSON.stringify(plan.needsBootstrap)]);
    }
    await client.query(options.dryRun ? 'rollback' : 'commit');
    return plan;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

