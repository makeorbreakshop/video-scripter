import { shadowEnabled, shadowSave, writeChunkBoth, FileShadowLedger, shadowChunkKey } from './pipeline-shadow';

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

describe('writeChunkBoth: the local pipeline DB is written first, once per chunk', () => {
  const ledgerOf = () => {
    const ids = new Set<string>();
    return { ids, has: (id: string) => ids.has(id), add: (id: string) => { ids.add(id); } };
  };

  it('writes local before Supabase and records the chunk', async () => {
    const order: string[] = [];
    const ledger = ledgerOf();
    const r = await writeChunkBoth({
      id: 'c1', ledger,
      local: async () => { order.push('local'); return { ok: true, rows: 3 }; },
      remote: async () => { order.push('remote'); return { rss_samples: 3 }; },
    });
    expect(order).toEqual(['local', 'remote']);
    expect(r.local).toEqual({ ok: true, rows: 3 });
    expect(ledger.has('c1')).toBe(true);
  });

  it('keeps the readings locally when Supabase fails (the 57014 that used to lose them)', async () => {
    const ledger = ledgerOf();
    await expect(writeChunkBoth({
      id: 'c2', ledger,
      local: async () => ({ ok: true, rows: 5 }),
      remote: async () => { throw new Error('canceling statement due to statement timeout'); },
    })).rejects.toThrow(/statement timeout/);
    expect(ledger.has('c2')).toBe(true);
  });

  it('does not rewrite locally a chunk it already holds when Supabase retries it', async () => {
    const ledger = ledgerOf();
    ledger.add('c3');
    let localCalls = 0;
    const r = await writeChunkBoth({
      id: 'c3', ledger,
      local: async () => { localCalls++; return { ok: true, rows: 5 }; },
      remote: async () => ({ rss_samples: 5 }),
    });
    expect(localCalls).toBe(0);
    expect(r.local).toEqual({ ok: true, rows: 0, skipped: 'already-local' });
  });

  it('a local failure never blocks Supabase, and the chunk is retried locally next time', async () => {
    const ledger = ledgerOf();
    const r = await writeChunkBoth({
      id: 'c4', ledger,
      local: async () => ({ ok: false, rows: 0, error: 'ECONNREFUSED' }),
      remote: async () => ({ rss_samples: 2 }),
    });
    expect(r.remote).toEqual({ rss_samples: 2 });
    expect(ledger.has('c4')).toBe(false);
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
