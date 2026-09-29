// The materializer's claim used to return every claimed video's current cache blob (6.3 MB per
// 5-minute run on 2026-09-29, 97 % of its egress). With a blob store it claims md5s, fetches only
// the blobs it does not hold, and keeps a copy of every blob it writes.
import { materializeObservationBatch } from './observation-materializer';
import { OBS_DIRTY_CLAIM_VERSIONED_SQL, OBS_CACHE_BLOBS_SQL } from './materialization-queue';
import { MemoryObsBlobStore, blobVersion } from './obs-blob-store';
import { encodeObservationState, decodeObservationState, type ObservationState } from './observation-state';

const state = (id: string, views: number, lastChangeId = 1): ObservationState => ({
  v: 2, videoId: id, publishedAt: '2026-01-01T00:00:00.000Z', lastChangeId,
  points: [{ source: 'sample', at: '2026-01-02T00:00:00.000Z', views, modelEligible: true, conflicted: false }],
});

function fakeClient(server: Map<string, Buffer>, changes: any[]) {
  const log: { sql: string; values?: any[] }[] = [];
  return {
    log,
    async query(sql: string, values?: any[]) {
      log.push({ sql, values });
      if (sql === OBS_DIRTY_CLAIM_VERSIONED_SQL) {
        return { rows: [...server].map(([id, obs]) => ({
          video_id: id, generation: 5, requires_bootstrap: false, format: 2, last_change_id: 1,
          obs_md5: blobVersion(obs), published_at: '2026-01-01T00:00:00Z' })), rowCount: server.size };
      }
      if (sql === OBS_CACHE_BLOBS_SQL) {
        const ids: string[] = values![0];
        return { rows: ids.map((id) => ({ video_id: id, obs: server.get(id) })), rowCount: ids.length };
      }
      if (/observation_change_log/.test(sql) && /select/i.test(sql)) return { rows: changes, rowCount: changes.length };
      return { rows: [], rowCount: 0 };
    },
  };
}

const opts = { maxVideos: 100, maxChanges: 100, maxCacheBytes: 1e6, maxCompressedBytes: 1e6 };

test('fetches only the blobs it does not already hold, and applies changes on top of the local copy', async () => {
  const a = encodeObservationState(state('a', 10));
  const b = encodeObservationState(state('b', 20));
  const store = new MemoryObsBlobStore();
  store.put('a', 2, a);
  const change = { change_id: 5, video_id: 'a', source: 'sample', operation: 'upsert', at: '2026-01-03T00:00:00Z',
                   views: 30, time_basis: null, received_at: null, model_eligible: true, conflicted: false };
  const c = fakeClient(new Map([['a', a], ['b', b]]), [change]);

  const plan = await materializeObservationBatch(c, { ...opts, blobStore: store });

  const fetches = c.log.filter((l) => l.sql === OBS_CACHE_BLOBS_SQL);
  expect(fetches).toHaveLength(1);
  expect(fetches[0].values).toEqual([['b']]);
  expect(c.log.some((l) => /obs_cache_dirty/.test(l.sql) && /oc\.obs,/.test(l.sql))).toBe(false);

  // The change landed on a's local state, and the committed blob is now held locally.
  const upA = plan.upserts.find((u) => u.videoId === 'a')!;
  expect(decodeObservationState(upA.obs).points.map((p) => p.views)).toEqual([10, 30]);
  expect(store.get('a')!.version).toBe(blobVersion(upA.obs));
  expect(store.get('b')!.version).toBe(blobVersion(b));
});

test('a dry run commits nothing and so stores nothing it wrote', async () => {
  const a = encodeObservationState(state('a', 10));
  const store = new MemoryObsBlobStore();
  const change = { change_id: 5, video_id: 'a', source: 'sample', operation: 'upsert', at: '2026-01-03T00:00:00Z',
                   views: 30, time_basis: null, received_at: null, model_eligible: true, conflicted: false };
  const plan = await materializeObservationBatch(fakeClient(new Map([['a', a]]), [change]),
    { ...opts, dryRun: true, blobStore: store });
  expect(plan.upserts).toHaveLength(1);
  // Only the fetched server blob is held — not the uncommitted one.
  expect(store.get('a')!.version).toBe(blobVersion(a));
});

test('the versioned claim keeps the queue ordering and byte budget but returns md5, not the blob', () => {
  expect(OBS_DIRTY_CLAIM_VERSIONED_SQL).toMatch(/md5\(oc\.obs\) as obs_md5/);
  expect(OBS_DIRTY_CLAIM_VERSIONED_SQL).not.toMatch(/oc\.obs,/);
  expect(OBS_DIRTY_CLAIM_VERSIONED_SQL).toMatch(/running_bytes <= \$2/);
});
