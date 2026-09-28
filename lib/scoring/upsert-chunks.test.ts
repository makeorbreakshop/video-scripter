import { chunkByBytes, UPSERT_CHUNK_BYTES } from './upsert-chunks';

// 2026-09-28: the observation cache upsert sent one unnest() of up to 25 MB of bytea per
// statement. unnest's result is materialised in a tuplestore, and past work_mem (5 MB) it spills:
// measured on a temp table, 25.2 MB → 24 MB of temp written; 4.2 MB → none. 7.2 GB of temp in two
// days from this one statement. Chunks stay under work_mem.
const row = (id: string, bytes: number) => ({ videoId: id, obs: Buffer.alloc(bytes) });

describe('chunkByBytes', () => {
  it('keeps every chunk under the byte budget, in order, losing nothing', () => {
    const rows = Array.from({ length: 900 }, (_, i) => row(`v${i}`, 28_000));
    const chunks = chunkByBytes(rows, (r) => r.obs.length, 4_000_000);
    expect(chunks.flat()).toEqual(rows);
    for (const c of chunks) expect(c.reduce((s, r) => s + r.obs.length, 0)).toBeLessThanOrEqual(4_000_000);
    expect(chunks.length).toBe(7);
  });

  it('puts a single oversized row in a chunk of its own rather than dropping it', () => {
    const chunks = chunkByBytes([row('a', 10), row('big', 9_000_000), row('b', 10)], (r) => r.obs.length, 4_000_000);
    expect(chunks.map((c) => c.map((r) => r.videoId))).toEqual([['a'], ['big'], ['b']]);
  });

  it('returns no chunks for no rows', () => {
    expect(chunkByBytes([], () => 1, 10)).toEqual([]);
  });

  it('defaults under work_mem (5 MB)', () => {
    expect(UPSERT_CHUNK_BYTES).toBeLessThan(5 * 1024 * 1024);
  });
});

describe('upsertCacheRows', () => {
  it('issues one statement per chunk, each under the budget, covering every row', async () => {
    const { upsertCacheRows } = await import('./observation-materializer');
    const calls: unknown[][] = [];
    const client = { query: async (_sql: string, values?: any[]) => { calls.push(values ?? []); return { rows: [], rowCount: 0 }; } };
    const rows = Array.from({ length: 300 }, (_, i) => ({ videoId: `v${i}`, n: 1, obs: Buffer.alloc(40_000), lastChangeId: i }));
    await upsertCacheRows(client, rows, 4_000_000);
    expect(calls.length).toBe(3);
    expect(calls.flatMap((v) => v[0] as string[])).toEqual(rows.map((r) => r.videoId));
    for (const v of calls) expect((v[2] as Buffer[]).reduce((s, b) => s + b.length, 0)).toBeLessThanOrEqual(4_000_000);
  });
});
