import type { VideoSeriesFile } from '../readings/series';
import {
  applyObservationChanges,
  emptyObservationState,
  type ObservationChange,
  type ObservationSource,
  type ObservationState,
} from './observation-state';

export const MAX_BOOTSTRAP_VIDEOS = 500;
export const MAX_BOOTSTRAP_RAW_ROWS = 100_000;
export const MAX_BOOTSTRAP_BATCHES = 2;
export const DEFAULT_BOOTSTRAP_R2_CONCURRENCY = 16;
export const MAX_BOOTSTRAP_R2_CONCURRENCY = 16;

export async function runSequentialBootstrapBatches<T extends { videos: number }>(options: {
  maxBatches: number;
  signal: AbortSignal;
  runBatch: (batch: number) => Promise<T>;
}): Promise<T[]> {
  const results: T[] = [];
  const batchLimit = Math.min(options.maxBatches, MAX_BOOTSTRAP_BATCHES);
  for (let batch = 1; batch <= batchLimit && !options.signal.aborted; batch++) {
    const result = await options.runBatch(batch);
    results.push(result);
    if (result.videos === 0) break;
  }
  return results;
}

export function validateBootstrapR2Concurrency(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('--r2-concurrency must be a positive integer');
  }
  if (value > MAX_BOOTSTRAP_R2_CONCURRENCY) {
    throw new Error(`--r2-concurrency exceeds hard limit ${MAX_BOOTSTRAP_R2_CONCURRENCY}`);
  }
  return value;
}

export function bootstrapSource(
  file: VideoSeriesFile | null,
  captureStartedAt: string | Date,
  latestPreCaptureWriteAt: string | Date | null,
): 'r2' | 'raw' {
  if (!file) return 'raw';
  const builtAt = Date.parse(file.built_at);
  if (!Number.isFinite(builtAt)) return 'raw';
  if (builtAt >= new Date(captureStartedAt).getTime()) return 'r2';
  return latestPreCaptureWriteAt === null || builtAt >= new Date(latestPreCaptureWriteAt).getTime()
    ? 'r2' : 'raw';
}

export function validateRawBootstrapBudget(
  actual: { videos: number; rows: number },
  budget: { rawVideoBudget?: number; rawRowBudget?: number },
): void {
  if (budget.rawVideoBudget === undefined) throw new Error('raw bootstrap requires --raw-video-budget');
  if (budget.rawRowBudget === undefined) throw new Error('raw bootstrap requires --raw-row-budget');
  if (actual.videos > budget.rawVideoBudget) {
    throw new Error(`raw bootstrap video count ${actual.videos} exceeds video budget ${budget.rawVideoBudget}`);
  }
  if (actual.rows > budget.rawRowBudget) {
    throw new Error(`raw bootstrap row count ${actual.rows} exceeds row budget ${budget.rawRowBudget}`);
  }
}

export interface BootstrapObservationRow {
  source: ObservationSource;
  at: string | Date;
  views: number | string | null;
  time_basis?: string | null;
  received_at?: string | Date | null;
  model_eligible?: boolean | null;
  conflicted?: boolean | null;
}

export function observationStateFromRows(
  videoId: string,
  publishedAt: string | Date,
  rows: readonly BootstrapObservationRow[],
  lastChangeId = 0,
): ObservationState {
  const changes: ObservationChange[] = rows.map((row, index) => ({
    changeId: index + 1,
    videoId,
    source: row.source,
    operation: 'upsert',
    at: new Date(row.at).toISOString(),
    views: row.views === null ? null : Number(row.views),
    timeBasis: row.time_basis,
    receivedAt: row.received_at ? new Date(row.received_at).toISOString() : null,
    modelEligible: row.source === 'rss' ? row.model_eligible !== false : true,
    conflicted: row.source === 'rss' ? Boolean(row.conflicted) : false,
  }));
  const state = applyObservationChanges(emptyObservationState(videoId, publishedAt), changes);
  return { ...state, lastChangeId };
}

export const BOOTSTRAP_CLAIM_SQL = `
  /* trace:bootstrap.queue-claim */
  with recent_dependencies as materialized (
    select d.video_id, d.generation, d.not_before, d.marked_at
      from obs_cache_dirty d
     where d.requires_bootstrap and d.not_before <= now()
       and d.marked_at >= now() - interval '10 minutes'
     order by d.marked_at desc, d.not_before, d.video_id
     limit greatest(1, ceil($1::numeric / 5)::int)
  ), fifo as materialized (
    select d.video_id, d.generation, d.not_before, d.marked_at
      from obs_cache_dirty d
     where d.requires_bootstrap and d.not_before <= now()
       and not exists (select 1 from recent_dependencies r where r.video_id=d.video_id)
     order by d.not_before, d.marked_at, d.video_id
     limit greatest($1 - (select count(*) from recent_dependencies), 0)
  ), picked as (
    select r.*, 0 as lane from recent_dependencies r
    union all
    select f.*, 1 as lane from fifo f
  )
  select p.video_id, p.generation, v.published_at, m.capture_started_at
    from picked p
    join videos v on v.id=p.video_id
    cross join observation_materialization_meta m
   where m.singleton
   order by lane,
            case when lane=0 then p.marked_at end desc,
            p.not_before, p.marked_at, p.video_id`;

/**
 * One timestamp per video, never observation rows. If an R2 series file was built after the last
 * source write that predates trigger capture, the file plus the captured deltas is a complete
 * bootstrap source and no history needs to cross the Supabase wire.
 */
export const BOOTSTRAP_LATEST_WRITE_SQL = `
  /* trace:bootstrap.latest-write */
  select requested.video_id,
         nullif(greatest(
           coalesce((select max(s.created_at) from view_snapshots s
                      where s.video_id=requested.video_id and s.created_at < m.capture_started_at), '-infinity'::timestamptz),
           coalesce((select max(s.sampled_at) from view_samples s
                      where s.video_id=requested.video_id and s.sampled_at < m.capture_started_at), '-infinity'::timestamptz),
           coalesce((select max(coalesce(s.received_at,s.at)) from rss_samples s
                      where s.video_id=requested.video_id and coalesce(s.received_at,s.at) < m.capture_started_at), '-infinity'::timestamptz)
         ), '-infinity'::timestamptz) as latest_write_at
    from unnest($1::text[]) as requested(video_id)
    cross join observation_materialization_meta m
   where m.singleton`;

export const BOOTSTRAP_RAW_COUNT_SQL = `
  /* trace:bootstrap.raw-count */
  select (
    (select count(*) from view_snapshots where video_id=any($1::text[])) +
    (select count(*) from view_samples where video_id=any($1::text[])) +
    (select count(*) from rss_samples where video_id=any($1::text[]))
  )::text as n`;

export const BOOTSTRAP_RAW_ROWS_SQL = `
  /* trace:bootstrap.raw-read */
  with target_videos as materialized (
    select id, published_at from videos where id=any($1::text[])
  )
  select x.video_id, x.source, x.at, x.views, x.time_basis, x.received_at,
         x.model_eligible, x.conflicted, v.published_at
    from (
      select video_id, 'snapshot'::text as source,
             snapshot_date::timestamptz + interval '12 hours' as at,
             view_count::bigint as views, null::text as time_basis,
             null::timestamptz as received_at, true as model_eligible, false as conflicted
        from view_snapshots where video_id=any($1::text[])
      union all
      select video_id, 'sample', sampled_at, view_count::bigint, null, null, true, false
        from view_samples where video_id=any($1::text[])
      union all
      select video_id, 'rss', at, views, time_basis, received_at, model_eligible, conflicted
        from rss_samples where video_id=any($1::text[])
    ) x join target_videos v on v.id=x.video_id
   where x.at >= v.published_at and x.at <= now()
   order by x.video_id, x.at, x.source`;
