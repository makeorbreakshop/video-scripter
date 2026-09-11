import { gzipSync, gunzipSync } from 'node:zlib';
import { mergeObservations, type Observation, type ObservationPoint } from './observations';
import type { VideoSeriesFile } from '../readings/series';

export const OBSERVATION_STATE_VERSION = 2 as const;

export type ObservationSource = 'snapshot' | 'sample' | 'rss';
export type ObservationOperation = 'upsert' | 'delete';

export interface ObservationChange {
  changeId: number;
  videoId: string;
  source: ObservationSource;
  operation: ObservationOperation;
  at: string;
  views: number | null;
  timeBasis?: string | null;
  receivedAt?: string | null;
  modelEligible?: boolean;
  conflicted?: boolean;
}

export interface ObservationStatePoint {
  source: ObservationSource;
  at: string;
  views: number | null;
  timeBasis?: string | null;
  receivedAt?: string | null;
  modelEligible: boolean;
  conflicted: boolean;
}

export interface ObservationState {
  v: typeof OBSERVATION_STATE_VERSION;
  videoId: string;
  publishedAt: string;
  lastChangeId: number;
  points: ObservationStatePoint[];
}

const sourceOrder: Record<ObservationSource, number> = { snapshot: 0, rss: 1, sample: 2 };
const keyOf = (point: Pick<ObservationStatePoint, 'source' | 'at'>) => `${point.source}:${point.at}`;
const iso = (value: string | Date): string => new Date(value).toISOString();

function canonical(points: Iterable<ObservationStatePoint>): ObservationStatePoint[] {
  return [...points].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)
    || sourceOrder[a.source] - sourceOrder[b.source]);
}

export function emptyObservationState(videoId: string, publishedAt: string | Date): ObservationState {
  return { v: OBSERVATION_STATE_VERSION, videoId, publishedAt: iso(publishedAt), lastChangeId: 0, points: [] };
}

/** Apply database changes by their source primary key. This is exact for insert/update/delete. */
export function applyObservationChanges(
  state: ObservationState,
  changes: readonly ObservationChange[],
): ObservationState {
  const points = new Map(state.points.map((point) => [keyOf(point), point]));
  let lastChangeId = state.lastChangeId;
  for (const change of [...changes].sort((a, b) => a.changeId - b.changeId)) {
    if (change.changeId <= state.lastChangeId) continue;
    const at = iso(change.at);
    const key = keyOf({ source: change.source, at });
    if (change.operation === 'delete') points.delete(key);
    else points.set(key, {
      source: change.source,
      at,
      views: change.views === null ? null : Number(change.views),
      ...(change.timeBasis == null ? {} : { timeBasis: change.timeBasis }),
      ...(change.receivedAt == null ? {} : { receivedAt: iso(change.receivedAt) }),
      modelEligible: change.source === 'rss' ? change.modelEligible !== false : true,
      conflicted: change.source === 'rss' ? Boolean(change.conflicted) : false,
    });
    lastChangeId = Math.max(lastChangeId, change.changeId);
  }
  return { ...state, lastChangeId, points: canonical(points.values()) };
}

/** Run the one canonical merge implementation at read time; the stored raw subset remains mutable. */
export function observationsFromState(state: ObservationState, asOf = Date.now()): Observation[] {
  const bySource: Record<ObservationSource, ObservationPoint[]> = { snapshot: [], sample: [], rss: [] };
  for (const point of state.points) {
    if (point.views === null || point.views < 0) continue;
    if (point.source === 'rss' && (!point.modelEligible || point.conflicted)) continue;
    bySource[point.source].push({
      at: point.at,
      views: point.views,
      ...(point.timeBasis ? { timeBasis: point.timeBasis } : {}),
      ...(point.receivedAt ? { receivedAt: point.receivedAt } : {}),
    });
  }
  return mergeObservations(state.publishedAt, bySource.snapshot, bySource.sample, bySource.rss, asOf);
}

export function encodeObservationState(state: ObservationState): Buffer {
  return gzipSync(Buffer.from(JSON.stringify({ ...state, points: canonical(state.points) }), 'utf8'), { level: 9 });
}

export function decodeObservationState(buf: Buffer | Uint8Array): ObservationState {
  const parsed = JSON.parse(gunzipSync(Buffer.from(buf)).toString('utf8')) as ObservationState;
  if (!parsed || parsed.v !== OBSERVATION_STATE_VERSION || !Array.isArray(parsed.points)) {
    throw new Error(`unsupported observation state version: ${(parsed as any)?.v ?? 'missing'}`);
  }
  return { ...parsed, points: canonical(parsed.points) };
}

/** Seed the v2 projection from the R2 series serving object without touching Supabase history. */
export function observationStateFromSeries(file: VideoSeriesFile, lastChangeId = 0): ObservationState {
  if (!file.published_at) throw new Error(`series ${file.video_id} has no published_at`);
  const changes: ObservationChange[] = [];
  let id = 0;
  for (const row of file.snapshots) changes.push({
    changeId: ++id, videoId: file.video_id, source: 'snapshot', operation: 'upsert',
    at: row.at, views: row.views,
  });
  for (const row of file.samples) changes.push({
    changeId: ++id, videoId: file.video_id, source: 'sample', operation: 'upsert',
    at: row.at, views: row.views,
  });
  for (const row of file.rss) changes.push({
    changeId: ++id, videoId: file.video_id, source: 'rss', operation: 'upsert',
    at: row.at, views: row.views, timeBasis: row.timeBasis, receivedAt: row.receivedAt,
    modelEligible: row.eligible, conflicted: row.conflicted,
  });
  const seeded = applyObservationChanges(emptyObservationState(file.video_id, file.published_at), changes);
  return { ...seeded, lastChangeId };
}

