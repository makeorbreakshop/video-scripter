import { incrementalScoreTargetsSql, walkIncrementalScoreTargets } from './target-selection';

test('incremental scoring reads a bounded deterministic page below its prior cursor', () => {
  const first = incrementalScoreTargetsSql({ all: false, channels: [], limit: 100, cursor: null });
  expect(first.text).toContain("v.published_at > now() - interval '60 days'");
  expect(first.text).toContain('v.published_at is not null');
  expect(first.text).toContain('order by v.published_at desc, v.id desc');
  expect(first.values.at(-1)).toBe(100);

  const next = incrementalScoreTargetsSql({
    all: true, channels: ['channel'], limit: 37,
    cursor: { publishedAt: '2026-01-02T00:00:00Z', id: 'video' },
  });
  expect(next.text).toContain('(v.published_at, v.id) <');
  expect(next.text).toContain('v.channel_id = any(');
  expect(next.values).toEqual([
    ['channel'], '2026-01-02T00:00:00Z', 'video', 37,
  ]);
});

test('page size cannot exceed the bounded scoring work unit', () => {
  expect(() => incrementalScoreTargetsSql({ all: false, channels: [], limit: 101, cursor: null })).toThrow('100');
});

test('walks dirty targets once by exact database cursor even when processing leaves one dirty', async () => {
  const rows = Array.from({ length: 205 }, (_, i) => ({
    id: `v-${String(999 - i).padStart(3, '0')}`,
    channel_id: 'c',
    published_at: i < 2 ? '2026-09-04 12:00:00.123456+00' : `2026-09-03 11:${String(59 - (i % 60)).padStart(2, '0')}:00+00`,
  })).sort((a, b) => b.published_at.localeCompare(a.published_at) || b.id.localeCompare(a.id));
  const visited: string[] = [];
  const fetchPage = jest.fn(async (cursor: { publishedAt: string; id: string } | null, limit: number) => rows
    .filter((r) => !cursor || r.published_at < cursor.publishedAt || (r.published_at === cursor.publishedAt && r.id < cursor.id))
    .slice(0, limit));

  const selected = await walkIncrementalScoreTargets({
    limit: 203, signal: new AbortController().signal, fetchPage,
    onPage: async (page) => { visited.push(...page.map((r) => r.id)); },
  });

  expect(selected).toBe(203);
  expect(visited).toEqual(rows.slice(0, 203).map((r) => r.id));
  expect(new Set(visited).size).toBe(203);
  expect(fetchPage.mock.calls.every(([, limit]) => limit <= 100)).toBe(true);
});
