import { enqueueScoreRolloutSql } from './score-rollout';

test('a model rollout enqueues only a bounded ID page and never reads observation histories', () => {
  const q = enqueueScoreRolloutSql({ version: 'v5.4', limit: 5000, cursor: null, channels: [] });
  expect(q.text).toContain('insert into score_dirty');
  expect(q.text).toContain('sc.model_version');
  expect(q.text).toContain('nextval');
  expect(q.text).not.toMatch(/rss_samples|view_samples|view_snapshots/);
  expect(q.values).toEqual(['v5.4', 5000]);
  expect(() => enqueueScoreRolloutSql({ version: 'v5.4', limit: 5001, cursor: null, channels: [] })).toThrow('5000');
  expect(() => enqueueScoreRolloutSql({ version: '', limit: 1, cursor: null, channels: [] })).toThrow('version');
});

test('rollout continuation uses an exact publication/id cursor', () => {
  const q = enqueueScoreRolloutSql({
    version: 'v5.4', limit: 100, channels: ['channel'],
    cursor: { publishedAt: '2026-09-01T00:00:00Z', id: 'video' },
  });
  expect(q.text).toMatch(/\(v\.published_at,\s*v\.id\)\s*</);
  expect(q.text).toMatch(/v\.channel_id\s*=\s*any/);
  expect(q.values).toEqual(['v5.4', ['channel'], '2026-09-01T00:00:00Z', 'video', 100]);
});
