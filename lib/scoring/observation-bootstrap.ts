import type { VideoSeriesFile } from '../readings/series';
import {
  applyObservationChanges,
  emptyObservationState,
  type ObservationChange,
  type ObservationSource,
  type ObservationState,
} from './observation-state';

export const MAX_BOOTSTRAP_VIDEOS = 100;
export const MAX_BOOTSTRAP_RAW_ROWS = 100_000;

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
  select d.video_id, d.generation, v.published_at, m.capture_started_at
    from obs_cache_dirty d
    join videos v on v.id=d.video_id
    cross join observation_materialization_meta m
   where d.requires_bootstrap and d.not_before <= now() and m.singleton
   order by d.not_before, d.marked_at, d.video_id
   limit $1
   for update of d skip locked`;

/**
 * One timestamp per video, never observation rows. If an R2 series file was built after the last
 * source write that predates trigger capture, the file plus the captured deltas is a complete
 * bootstrap source and no history needs to cross the Supabase wire.
 */
export const BOOTSTRAP_LATEST_WRITE_SQL = `
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
  select (
    (select count(*) from view_snapshots where video_id=any($1::text[])) +
    (select count(*) from view_samples where video_id=any($1::text[])) +
    (select count(*) from rss_samples where video_id=any($1::text[]))
  )::text as n`;

export const BOOTSTRAP_RAW_ROWS_SQL = `
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
