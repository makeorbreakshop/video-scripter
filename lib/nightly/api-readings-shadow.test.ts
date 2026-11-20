import { shadowSampleBatch, shadowDueSnapshots } from './api-readings-shadow';

const broken = { connect: async () => { throw new Error('ECONNREFUSED 127.0.0.1:5434'); },
                 query: async () => { throw new Error('ECONNREFUSED 127.0.0.1:5434'); } };

describe('API readings shadow write', () => {
  it('never fails the job: a local error is reported, not thrown', async () => {
    const r = await shadowSampleBatch(broken as never, [{ videoId: 'v', sampledAt: new Date('2026-11-20T20:00:00Z'), views: 1, likes: 0,
      comments: 0, daysSincePublished: 1, phase: 'launch', nextCheck: new Date(), priorNextCheck: '', priorUpdatedAt: '' }]);
    expect(r).toMatchObject({ ok: false, rows: 0 });
    expect(r.error).toMatch(/ECONNREFUSED/);
    const d = await shadowDueSnapshots(broken as never, [{ video_id: 'v', snapshot_date: '2026-11-20', view_count: 1, like_count: 0,
      comment_count: 0, days_since_published: 1, daily_views_rate: null }], true);
    expect(d.ok).toBe(false);
  });
  it('skips an empty batch without touching the database', async () => {
    expect(await shadowSampleBatch(broken as never, [])).toEqual({ ok: true, rows: 0 });
    expect(await shadowDueSnapshots(broken as never, [], true)).toEqual({ ok: true, rows: 0 });
  });
});
