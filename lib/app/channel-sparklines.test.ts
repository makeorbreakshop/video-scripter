import { buildSparklines, channelSparklines, refreshChannelSparklines, SPARK_ROWS_SQL } from './channel-sparklines';

const NOW = Date.parse('2026-09-08T12:00:00Z');
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('buildSparklines', () => {
  it('builds one line per requested channel, oldest point first, in the 90-day window', () => {
    const rows = [
      { channel_id: 'a', t: day(10), baseline: 200 },
      { channel_id: 'a', t: day(80), baseline: 100 },
      { channel_id: 'a', t: day(400), baseline: 50 },
    ];
    const out = buildSparklines(rows, ['a', 'b'], NOW);
    expect(out.a.points.map((p) => p.v)).toEqual([100, 200]);
    expect(out.a.pct).toBe(100);
    expect(out.b).toEqual({ points: [], pct: null });
  });

  it('falls back to the most recent points for a channel quiet for three months', () => {
    const rows = [
      { channel_id: 'a', t: day(200), baseline: 90 },
      { channel_id: 'a', t: day(150), baseline: 120 },
    ];
    expect(buildSparklines(rows, ['a'], NOW).a.points.map((p) => p.v)).toEqual([90, 120]);
  });

  it('drops null, zero and unparsable rows', () => {
    const rows = [
      { channel_id: 'a', t: day(1), baseline: null },
      { channel_id: 'a', t: day(2), baseline: 0 },
      { channel_id: 'a', t: 'nope', baseline: 5 },
      { channel_id: 'a', t: day(3), baseline: '7' },
    ];
    expect(buildSparklines(rows, ['a'], NOW).a.points).toEqual([{ t: Date.parse(day(3)), v: 7 }]);
  });
});

describe('channelSparklines', () => {
  it('reads stored lines and only builds the ones that are missing, writing them back', async () => {
    const calls: string[] = [];
    const stored = { points: [{ t: 1, v: 2 }], pct: null };
    const query = jest.fn(async (sql: string, params?: any[]) => {
      calls.push(sql.trim().slice(0, 40));
      if (sql.includes('from channel_stats where')) return [{ channel_id: 'a', spark: stored }];
      if (sql === SPARK_ROWS_SQL) { expect(params![0]).toEqual(['b']); return [{ channel_id: 'b', t: day(1), baseline: 9 }]; }
      if (sql.includes('update channel_stats')) { expect(params![0]).toEqual(['b']); return []; }
      throw new Error('unexpected ' + sql);
    }) as any;
    const out = await channelSparklines(['a', 'b', 'a'], query);
    expect(out.a).toBe(stored);
    expect(out.b.points).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('is one read when every line is stored', async () => {
    const query = jest.fn(async () => [{ channel_id: 'a', spark: { points: [], pct: null } }]) as any;
    await channelSparklines(['a'], query);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('ignores a malformed stored value and rebuilds it', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('from channel_stats where')) return [{ channel_id: 'a', spark: { nope: true } }];
      return [];
    }) as any;
    const out = await channelSparklines(['a'], query);
    expect(out.a).toEqual({ points: [], pct: null });
    expect(query).toHaveBeenCalledTimes(3);
  });
});

describe('refreshChannelSparklines', () => {
  it('stores the built line as JSON per channel', async () => {
    const query = jest.fn(async (sql: string, params?: any[]) => {
      if (sql === SPARK_ROWS_SQL) return [{ channel_id: 'a', t: day(1), baseline: 3 }];
      expect(JSON.parse(params![1][0]).points[0].v).toBe(3);
      return [];
    }) as any;
    await refreshChannelSparklines(['a'], query, NOW);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
