import { currentBaseline, currentBaselineSql } from './channel-baseline';
import { refreshChannelStatsSql } from './channel-stats';
import fs from 'node:fs';

describe('currentBaseline — the channel\'s normal NOW, not its lifetime median', () => {
  const rows = [
    { published_at: '2025-01-01T00:00:00Z', baseline: 100 },
    { published_at: '2026-08-28T00:00:00Z', baseline: 26697 },
    { published_at: '2026-02-20T00:00:00Z', baseline: 31168 },
  ];
  it('takes the newest published row that has a baseline', () => {
    expect(currentBaseline(rows)).toBe(26697);
  });
  it('is not the median — a growing channel reads its current level, not its history', () => {
    // Karpathy's shape: a long quiet history then one enormous recent video.
    const karpathy = [
      ...Array.from({ length: 20 }, (_, i) => ({ published_at: `2020-0${(i % 9) + 1}-01T00:00:00Z`, baseline: 312_038 })),
      { published_at: '2026-08-01T00:00:00Z', baseline: 5_782_654 },
    ];
    expect(currentBaseline(karpathy)).toBe(5_782_654);
  });
  it('skips newer rows with no baseline rather than reporting nothing', () => {
    expect(currentBaseline([{ published_at: '2026-09-01', baseline: null }, ...rows])).toBe(26697);
  });
  it('accepts pg numerics as strings and rejects zero, negative and unparseable rows', () => {
    expect(currentBaseline([{ published_at: '2026-01-01', baseline: '4200.5' }])).toBe(4200.5);
    expect(currentBaseline([{ published_at: '2026-01-01', baseline: 0 }])).toBeNull();
    expect(currentBaseline([{ published_at: '2026-01-01', baseline: -5 }])).toBeNull();
    expect(currentBaseline([{ published_at: null, baseline: 10 }])).toBeNull();
    expect(currentBaseline([])).toBeNull();
  });
});

describe('one definition, both call sites', () => {
  it('is newest-first and long-form only, and never a percentile', () => {
    const sql = currentBaselineSql('$1');
    expect(sql).toContain('order by vb.published_at desc');
    expect(sql).toContain('limit 1');
    expect(sql).not.toContain('percentile_cont');
  });
  it('is the fragment channel_stats.baseline is built from', () => {
    expect(refreshChannelStatsSql(false)).toContain(currentBaselineSql('c.channel_id'));
  });
  it('is the fragment the channel header falls back to', () => {
    expect(fs.readFileSync(require.resolve('./channel-page'), 'utf8')).toContain('currentBaselineSql');
  });
});
