import { shadowEnabled, shadowSave, shadowChunks, FileShadowLedger, shadowChunkKey } from './pipeline-shadow';

describe('rss-poll pipeline shadow write', () => {
  it('is off unless PIPELINE_SHADOW=1', () => {
    expect(shadowEnabled({})).toBe(false);
    expect(shadowEnabled({ PIPELINE_SHADOW: '0' })).toBe(false);
    expect(shadowEnabled({ PIPELINE_SHADOW: '1' })).toBe(true);
  });

  it('never fails the tick: a local error is reported, not thrown', async () => {
    const broken = { connect: async () => { throw new Error('ECONNREFUSED 127.0.0.1:5434'); },
                     query: async () => { throw new Error('ECONNREFUSED 127.0.0.1:5434'); } };
    const r = await shadowSave(broken as never, {
      samples: [{ video_id: 'v', at: '2026-11-20T12:00:00Z', views: 1, likes: 0 }],
      responses: [{ channelId: 'c', fetchedAt: '2026-11-20T12:00:00Z', date: null, age: null, cacheControl: null, views: { v: 1 } }],
    });
    expect(r.ok).toBe(false);
    expect(r.rows).toBe(0);
    expect(r.error).toMatch(/ECONNREFUSED/);
  });

  it('skips an empty chunk without touching the database', async () => {
    const untouchable = { connect: async () => { throw new Error('touched'); }, query: async () => { throw new Error('touched'); } };
    expect(await shadowSave(untouchable as never, { samples: [], responses: [] })).toEqual({ ok: true, rows: 0 });
  });
});

describe('shadowChunks: every chunk is written locally before Supabase is tried', () => {
  const ledgerOf = () => {
    const ids = new Set<string>();
    return { ids, has: (id: string) => ids.has(id), add: (id: string) => { ids.add(id); } };
  };
  const chunk = (id: string, n = 1) => ({
    samples: Array.from({ length: n }, (_, k) => ({ video_id: `${id}-${k}`, at: '2026-11-20T20:00:00Z', views: k, likes: 0 })),
    responses: [{ channelId: id, fetchedAt: '2026-11-20T20:00:00Z', date: null, age: null, cacheControl: null, views: {} }],
  });

  it('writes all chunks, so a Supabase stall on chunk 1 no longer holds chunks 2..n back (2026-11-20 20:41 tick)', async () => {
    const ledger = ledgerOf();
    const seen: string[] = [];
    const t = await shadowChunks([chunk('a', 2), chunk('b', 3)], ledger, async (c) => { seen.push(c.responses[0].channelId); return { ok: true, rows: c.samples.length }; });
    expect(seen).toEqual(['a', 'b']);
    expect(t).toMatchObject({ chunks: 2, rows: 5, skipped: 0, failed: 0 });
    expect(ledger.ids.size).toBe(2);
  });

  it('does not rewrite a chunk local already holds when Supabase retries it next tick', async () => {
    const ledger = ledgerOf();
    ledger.add(shadowChunkKey(chunk('a')));
    let calls = 0;
    const t = await shadowChunks([chunk('a'), chunk('b')], ledger, async () => { calls++; return { ok: true, rows: 1 }; });
    expect(calls).toBe(1);
    expect(t).toMatchObject({ chunks: 2, rows: 1, skipped: 1 });
  });

  it('a failed local chunk is reported and left out of the ledger, so the next tick retries it', async () => {
    const ledger = ledgerOf();
    const t = await shadowChunks([chunk('a'), chunk('b')], ledger,
      async (c) => c.responses[0].channelId === 'a' ? { ok: false, rows: 0, error: 'ECONNREFUSED' } : { ok: true, rows: 1 });
    expect(t).toMatchObject({ failed: 1, rows: 1 });
    expect(t.errors).toEqual(['ECONNREFUSED']);
    expect(ledger.has(shadowChunkKey(chunk('a')))).toBe(false);
    expect(ledger.has(shadowChunkKey(chunk('b')))).toBe(true);
  });
});

describe('FileShadowLedger', () => {
  it('survives a new process and forgets ids past their age', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const file = require('node:path').join(require('node:os').tmpdir(), `shadow-ledger-${process.pid}.json`);
    fs.rmSync(file, { force: true });
    const t0 = Date.parse('2026-11-20T20:00:00Z');
    const a = new FileShadowLedger(file, () => t0);
    a.add('old'); a.add('new');
    const b = new FileShadowLedger(file, () => t0 + 1000);
    expect(b.has('old')).toBe(true);
    const c = new FileShadowLedger(file, () => t0 + 8 * 86_400_000);
    expect(c.has('old')).toBe(false);
    fs.rmSync(file, { force: true });
  });
});

describe('shadowChunkKey', () => {
  const s = (video_id: string, views: number) => ({ video_id, at: '2026-11-20T20:00:00Z', views, likes: 0 });
  const resp = { channelId: 'c', fetchedAt: '2026-11-20T20:00:00Z', date: null, age: null, cacheControl: null, views: {} };
  it('is order-independent (flush sorts the buffers in place)', () => {
    expect(shadowChunkKey({ samples: [s('a', 1), s('b', 2)], responses: [resp] }))
      .toBe(shadowChunkKey({ samples: [s('b', 2), s('a', 1)], responses: [resp] }));
  });
  it('differs for chunks pending-replay chunkId would confuse (same count, same first id)', () => {
    expect(shadowChunkKey({ samples: [s('a', 1), s('b', 2)], responses: [resp] }))
      .not.toBe(shadowChunkKey({ samples: [s('a', 1), s('c', 2)], responses: [resp] }));
  });
});
