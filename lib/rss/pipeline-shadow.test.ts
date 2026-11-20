import { shadowEnabled, shadowSave } from './pipeline-shadow';

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
