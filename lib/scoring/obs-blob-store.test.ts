import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DiskObsBlobStore, MemoryObsBlobStore, blobVersion } from './obs-blob-store';
import { loadCachedRecords } from './prior-load';
import { OBS_CACHE_READ_VERSIONED_SQL } from './obs-cache';
import { encodeObservationState, type ObservationState } from './observation-state';

const state = (id: string, views: number): ObservationState => ({
  v: 2, videoId: id, publishedAt: '2026-01-01T00:00:00.000Z', lastChangeId: 1,
  points: [{ source: 'sample', at: '2026-01-02T00:00:00.000Z', views, modelEligible: true, conflicted: false }],
});

describe('the local observation blob store', () => {
  it('versions a blob by its content (md5, as Postgres computes it)', () => {
    expect(blobVersion(Buffer.from('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  it('round-trips through disk and ignores a corrupt or foreign file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blobs-'));
    const s = new DiskObsBlobStore(dir);
    const obs = encodeObservationState(state('vidA', 5));
    s.put('vidA', 2, obs);
    expect(new DiskObsBlobStore(dir).get('vidA')).toEqual({ version: blobVersion(obs), format: 2, obs });
    // The id is the file name; a truncated write must read as a miss, not as a wrong blob.
    const file = fs.readdirSync(dir, { recursive: true }).map(String).find((f) => f.endsWith('vidA'))!;
    fs.writeFileSync(path.join(dir, file), Buffer.concat([Buffer.from(blobVersion(obs) + '\n2\n'), obs.subarray(0, 3)]));
    expect(new DiskObsBlobStore(dir).get('vidA')).toBeNull();
    expect(s.get('never-stored')).toBeNull();
  });

  it('refuses ids that could escape its directory', () => {
    const s = new DiskObsBlobStore(fs.mkdtempSync(path.join(os.tmpdir(), 'blobs-')));
    expect(() => s.put('../x', 2, Buffer.from('a'))).toThrow();
    expect(s.get('../x')).toBeNull();
  });
});

describe('loadCachedRecords with a blob store: only changed blobs cross the wire', () => {
  it('sends the versions it holds, reuses the local blob when the server returns none, stores new ones', async () => {
    const store = new MemoryObsBlobStore();
    const a = encodeObservationState(state('a', 10));
    const b = encodeObservationState(state('b', 20));
    store.put('a', 2, a);
    const calls: any[][] = [];
    const q = jest.fn(async (sql: string, params?: any[]) => {
      calls.push([sql, params]);
      return [
        { video_id: 'a', obs: null, format: 2, last_change_id: 1, day30_views: 111 },   // unchanged
        { video_id: 'b', obs: b, format: 2, last_change_id: 1, day30_views: null },     // new
      ];
    });
    const day30 = new Map<string, number>();
    const r = await loadCachedRecords(q, ['a', 'b', 'c'], { requireFormat2: true, blobStore: store, day30Sink: day30 });

    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(OBS_CACHE_READ_VERSIONED_SQL);
    expect(calls[0][1]).toEqual([['a', 'b', 'c'], [blobVersion(a), null, null]]);
    expect(r.records.get('a')![0].views).toBe(10);
    expect(r.records.get('b')![0].views).toBe(20);
    expect(r.missingIds).toEqual(['c']);
    expect(day30.get('a')).toBe(111);
    expect(store.get('b')).toEqual({ version: blobVersion(b), format: 2, obs: b });
  });

  it('treats a null blob it cannot back locally as a miss, never as an empty record', async () => {
    const q = jest.fn(async () => [{ video_id: 'a', obs: null, format: 2, last_change_id: 1, day30_views: null }]);
    const r = await loadCachedRecords(q, ['a'], { requireFormat2: true, blobStore: new MemoryObsBlobStore() });
    expect(r.records.has('a')).toBe(false);
    expect(r.missingIds).toEqual(['a']);
  });

  it('keeps the server-side current-watermark filter and returns the blob only when its md5 differs', () => {
    expect(OBS_CACHE_READ_VERSIONED_SQL).toMatch(/c\.last_change_id\s*>=\s*d\.generation/);
    expect(OBS_CACHE_READ_VERSIONED_SQL).toMatch(/md5\(c\.obs\)\s*=\s*k\.version\s+then\s+null/i);
  });
});
