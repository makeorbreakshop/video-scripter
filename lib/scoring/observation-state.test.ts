import { observationRecords } from './observations';
import {
  applyObservationChanges,
  decodeObservationState,
  emptyObservationState,
  encodeObservationState,
  observationsFromState,
  type ObservationChange,
} from './observation-state';

const publishedAt = '2026-09-01T00:00:00.000Z';
const change = (
  changeId: number,
  source: ObservationChange['source'],
  operation: ObservationChange['operation'],
  at: string,
  views: number | null,
  extra: Partial<ObservationChange> = {},
): ObservationChange => ({
  changeId, videoId: 'video', source, operation, at, views,
  receivedAt: null, modelEligible: true, conflicted: false, ...extra,
});

function full(rows: ObservationChange[]) {
  const live = new Map<string, ObservationChange>();
  for (const row of rows) {
    const key = `${row.source}:${row.at}`;
    if (row.operation === 'delete') live.delete(key);
    else live.set(key, row);
  }
  return observationRecords([...live.values()]
    .filter((row) => row.views !== null && (row.source !== 'rss' || (row.modelEligible && !row.conflicted)))
    .map((row) => ({
      video_id: row.videoId,
      published_at: publishedAt,
      at: row.at,
      views: row.views!,
      source: row.source,
      received_at: row.receivedAt ?? undefined,
    }))).get('video') ?? [];
}

test('incremental insert, update, and delete materialization equals a fresh full rebuild', () => {
  const rows: ObservationChange[] = [
    change(1, 'snapshot', 'upsert', '2026-09-02T12:00:00.000Z', 100),
    change(2, 'rss', 'upsert', '2026-09-02T10:00:00.000Z', 90, { receivedAt: '2026-09-02T10:01:00.000Z' }),
    change(3, 'sample', 'upsert', '2026-09-02T11:00:00.000Z', 95),
    change(4, 'rss', 'upsert', '2026-09-03T10:00:00.000Z', 150, { receivedAt: '2026-09-03T10:01:00.000Z' }),
  ];
  let state = applyObservationChanges(emptyObservationState('video', publishedAt), rows);
  expect(observationsFromState(state)).toEqual(full(rows));

  const correction = change(5, 'rss', 'upsert', '2026-09-03T10:00:00.000Z', 140, {
    receivedAt: '2026-09-03T10:03:00.000Z', conflicted: true,
  });
  rows.push(correction);
  state = applyObservationChanges(state, [correction]);
  expect(observationsFromState(state)).toEqual(full(rows));

  const removal = change(6, 'sample', 'delete', '2026-09-02T11:00:00.000Z', null);
  rows.push(removal);
  state = applyObservationChanges(state, [removal]);
  expect(observationsFromState(state)).toEqual(full(rows));
  expect(state.lastChangeId).toBe(6);
});

test('the v2 projection has a deterministic gzip round trip', () => {
  const state = applyObservationChanges(emptyObservationState('video', publishedAt), [
    change(2, 'sample', 'upsert', '2026-09-03T00:00:00.000Z', 20),
    change(1, 'sample', 'upsert', '2026-09-02T00:00:00.000Z', 10),
  ]);
  expect(decodeObservationState(encodeObservationState(state))).toEqual(state);
  expect(encodeObservationState(state)).toEqual(encodeObservationState(state));
});
