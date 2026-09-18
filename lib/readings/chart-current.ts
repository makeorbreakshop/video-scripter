import { gunzipSync } from 'node:zlib';
import { buildSeriesFile, type VideoSeriesFile } from './series';
import { seriesInputFromObservationState, type ObservationState } from '../scoring/observation-state';

export const MAX_CHART_STATE_BYTES = 256_000;
export const MAX_CHART_METADATA_BYTES = 128_000;
export const MAX_CHART_DECODED_BYTES = 8 * 1024 * 1024;
export interface ChartQuery { <T>(sql: string, params: unknown[]): Promise<T[]> }

/** One deduplicated recovery request; the existing byte-bounded worker owns raw bootstrap. */
export const REQUEST_CHART_BOOTSTRAP_SQL = `
  /* trace:chart.request-bootstrap */
  insert into obs_cache_dirty(video_id,generation,requires_bootstrap,marked_at,not_before)
  select v.id, coalesce((select change_id from observation_change_log
    where video_id=v.id order by change_id desc limit 1),0), true, now(), now()
  from videos v where v.id=$1 and v.published_at is not null
    and not exists(select 1 from video_obs_cache c where c.video_id=v.id and c.format=2)
    and not exists(select 1 from obs_cache_dirty d where d.video_id=v.id)
  on conflict(video_id) do nothing`;

export async function readOrRequestCurrentChart(id: string, query: ChartQuery): Promise<VideoSeriesFile | null> {
  const file = await readCurrentChart(id, query);
  if (!file) await query(REQUEST_CHART_BOOTSTRAP_SQL, [id]);
  return file;
}

/**
 * One primary-key lookup plus two bounded packaging index reads. Reject before returning bytea
 * or JSON if either exceeds its budget; never ship a truncated chart as a complete result.
 * Dirty / requires-bootstrap state is not a current projection.
 */
export const CURRENT_CHART_SQL = `
  /* trace:chart.current-state */
  with current_state as materialized (
    select c.obs, c.built_at, c.last_change_id, v.published_at
      from video_obs_cache c join videos v on v.id=c.video_id
      left join obs_cache_dirty d on d.video_id=c.video_id
     where c.video_id=$1 and c.format=2
       and (d.video_id is null or (not d.requires_bootstrap and c.last_change_id>=d.generation))
  ), metadata as materialized (
    select jsonb_build_object('published_at', s.published_at,
      'thumbs', coalesce((select jsonb_agg(t order by t.version) from (
        select version, first_seen, last_checked, sha256, phash, r2_uploaded_at
        from thumbnail_versions where video_id=$1 order by version limit 501
      ) t), '[]'::jsonb),
      'titles', coalesce((select jsonb_agg(t order by t.version) from (
        select version, title, first_seen
        from title_versions where video_id=$1 order by version limit 501
      ) t), '[]'::jsonb)) as body from current_state s
  )
  select s.built_at, s.last_change_id,
         case when octet_length(s.obs)<=$2 then s.obs end as obs,
         case when octet_length(m.body::text)<=$3
           and jsonb_array_length(m.body->'thumbs')<=500
           and jsonb_array_length(m.body->'titles')<=500 then m.body end as metadata
    from current_state s cross join metadata m`;

export async function readCurrentChart(id: string, query: ChartQuery): Promise<VideoSeriesFile | null> {
  const rows = await query<{
    obs: Buffer | null; built_at: string | Date; last_change_id: string | number;
    metadata: { published_at: string; thumbs: Record<string, unknown>[]; titles: Record<string, unknown>[] } | null;
  }>(CURRENT_CHART_SQL, [id, MAX_CHART_STATE_BYTES, MAX_CHART_METADATA_BYTES]);
  const row = rows[0];
  if (!row?.obs || !row.metadata || row.obs.byteLength > MAX_CHART_STATE_BYTES) return null;
  try {
    const state = JSON.parse(gunzipSync(row.obs, { maxOutputLength: MAX_CHART_DECODED_BYTES }).toString('utf8')) as ObservationState;
    if (state.v !== 2 || state.videoId !== id || !Array.isArray(state.points)
      || !Number.isSafeInteger(state.lastChangeId) || state.lastChangeId !== Number(row.last_change_id)) return null;
    const file = buildSeriesFile({ videoId: id, builtAt: row.built_at,
      publishedAt: row.metadata.published_at ?? state.publishedAt,
      ...seriesInputFromObservationState(state), thumbs: row.metadata.thumbs, titles: row.metadata.titles });
    return { ...file, ...(state.deleted?.length ? { deleted: state.deleted } : {}) };
  } catch { return null; }
}
