import {
  emptyObservationState, encodeObservationState, observationsFromState,
  type ObservationChange,
} from './observation-state';
import {
  MATERIALIZER_LIMITS,
  planObservationMaterialization,
  type ObservationMaterializationClaim,
} from './observation-materializer';
import { OBS_DIRTY_CLAIM_SQL } from './materialization-queue';

const publishedAt = '2026-09-01T00:00:00.000Z';
const baseClaim = (overrides: Partial<ObservationMaterializationClaim> = {}): ObservationMaterializationClaim => ({
  videoId: 'video', generation: 2, requiresBootstrap: false, format: 2, lastChangeId: 0,
  publishedAt, obs: encodeObservationState(emptyObservationState('video', publishedAt)),
  ...overrides,
});
const delta = (changeId: number, views: number): ObservationChange => ({
  changeId, videoId: 'video', source: 'rss', operation: 'upsert',
  at: `2026-09-0${changeId + 1}T00:00:00.000Z`, views,
  modelEligible: true, conflicted: false,
});

test('a bounded delta batch produces a v2 upsert and exact-generation completion', () => {
  const plan = planObservationMaterialization([baseClaim()], [delta(1, 10), delta(2, 20)], {
    maxVideos: 100, maxChanges: 5000, maxCompressedBytes: 5_000_000, changesTruncated: false,
  });
  expect(plan.completed).toEqual([{ video_id: 'video', generation: 2 }]);
  expect(plan.partial).toEqual([]);
  expect(plan.needsBootstrap).toEqual([]);
  expect(plan.upserts).toHaveLength(1);
  expect(plan.upserts[0].lastChangeId).toBe(2);
  expect(observationsFromState(plan.upserts[0].state).map((p) => p.views)).toEqual([10, 20]);
  expect(plan.stats).toEqual(expect.objectContaining({ videos: 1, changes: 2, completed: 1 }));
});

test('a post-cutover video can materialize its complete delta log from an empty state', () => {
  const plan = planObservationMaterialization([
    baseClaim({ format: null, obs: null, lastChangeId: 0, requiresBootstrap: false }),
  ], [delta(1, 10), delta(2, 20)], {
    maxVideos: 100, maxChanges: 5000, maxCompressedBytes: 5_000_000, changesTruncated: false,
  });
  expect(plan.needsBootstrap).toEqual([]);
  expect(plan.completed).toEqual([{ video_id: 'video', generation: 2 }]);
  expect(plan.upserts[0].state.points).toHaveLength(2);
});

test('a globally truncated change page advances safely but does not clear the claimed generation', () => {
  const plan = planObservationMaterialization([baseClaim({ generation: 3 })], [delta(1, 10), delta(2, 20)], {
    maxVideos: 100, maxChanges: 2, maxCompressedBytes: 5_000_000, changesTruncated: true,
  });
  expect(plan.upserts[0].lastChangeId).toBe(2);
  expect(plan.completed).toEqual([]);
  expect(plan.partial).toEqual([{ video_id: 'video', generation: 3 }]);
});

test('missing, legacy, and gapped state is routed to bootstrap instead of guessed', () => {
  for (const claim of [
    baseClaim({ obs: null, format: null, requiresBootstrap: true }),
    baseClaim({ format: 1 }),
    baseClaim({ generation: 3, lastChangeId: 2 }),
  ]) {
    const plan = planObservationMaterialization([claim], [], {
      maxVideos: 100, maxChanges: 5000, maxCompressedBytes: 5_000_000, changesTruncated: false,
    });
    expect(plan.upserts).toEqual([]);
    expect(plan.needsBootstrap).toEqual([{ video_id: 'video', generation: claim.generation }]);
  }
});

test('hard video, delta, and compressed-byte ceilings fail before producing writes', () => {
  const opts = { maxVideos: MATERIALIZER_LIMITS.videos, maxChanges: MATERIALIZER_LIMITS.changes,
    maxCompressedBytes: MATERIALIZER_LIMITS.compressedBytes, changesTruncated: false };
  expect(() => planObservationMaterialization(
    Array.from({ length: MATERIALIZER_LIMITS.videos + 1 }, (_, i) => baseClaim({ videoId: `v${i}` })), [], opts,
  )).toThrow(String(MATERIALIZER_LIMITS.videos));
  expect(() => planObservationMaterialization(
    [baseClaim()], Array.from({ length: MATERIALIZER_LIMITS.changes + 1 }, (_, i) => delta(i + 1, i)), opts,
  )).toThrow(String(MATERIALIZER_LIMITS.changes));
  expect(() => planObservationMaterialization([baseClaim()], [delta(1, 10)], { ...opts, maxCompressedBytes: 1 }))
    .toThrow('compressed');
});

test('the recurring claim is capped by both video count and cache bytes on the server', () => {
  expect(MATERIALIZER_LIMITS.videos).toBe(20_000);
  expect(MATERIALIZER_LIMITS.changes).toBe(50_000);
  expect(MATERIALIZER_LIMITS.cacheBytes).toBe(25_000_000);
  expect(OBS_DIRTY_CLAIM_SQL).toMatch(/octet_length\(c\.obs\)/i);
  expect(OBS_DIRTY_CLAIM_SQL).toMatch(/running_bytes\s*<=\s*\$2/i);
});
