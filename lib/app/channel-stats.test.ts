jest.mock('../admin/db', () => ({ q: jest.fn() }));
import { q } from '../admin/db';
import { currentBaselineSql } from './channel-baseline';
import { refreshChannelStats, refreshChannelStatsSql, touchPackagingChange } from './channel-stats';

const mq = q as jest.Mock;
const norm = (s: string) => s.replace(/\s+/g, ' ');
beforeEach(() => { mq.mockReset(); mq.mockResolvedValue([]); });

describe('refreshChannelStats', () => {
  it('refreshes every tracked channel when given nothing', async () => {
    await refreshChannelStats();
    const sql = norm(String(mq.mock.calls[0][0]));
    expect(sql).toContain('select channel_id from user_channels union select channel_id from channel_tracking');
    expect(mq.mock.calls[0][1]).toEqual([]);
  });

  it('scopes to the channels a run touched', async () => {
    await refreshChannelStats(['UC1', 'UC2']);
    expect(norm(String(mq.mock.calls[0][0]))).toContain('select unnest($1::text[]) as channel_id');
    expect(mq.mock.calls[0][1]).toEqual([['UC1', 'UC2']]);
  });

  it('does nothing for an explicitly empty list rather than refreshing everything', async () => {
    await expect(refreshChannelStats([])).resolves.toBe(0);
    expect(mq).not.toHaveBeenCalled();
  });

  it('upserts rather than duplicating a channel', async () => {
    const sql = norm(refreshChannelStatsSql(false));
    expect(sql).toContain('on conflict (channel_id) do update');
    for (const col of ['video_count', 'latest_thumbnail_url', 'name', 'baseline', 'outliers', 'last_packaging_change']) {
      expect(sql).toContain(`${col} = excluded.${col}`);
    }
  });

  it('counts videos and outliers exactly as the old inline aggregates did, Shorts included', () => {
    const sql = norm(refreshChannelStatsSql(false));
    // Deliberately no longform predicate on the VIDEO COUNT: the channel list has always
    // counted Shorts, and that is preserved on purpose (see the module header).
    expect(sql).toContain('select count(*)::int as video_count, max(vv.channel_name) as name');
    expect(sql).not.toMatch(/from videos vv where vv\.channel_id = c\.channel_id and/);
    expect(sql).toContain("count(*) filter (where vs.score >= 2 and vs.confidence <> 'insufficient')");
    expect(sql).toContain("count(*) filter (where vs.score >= 2 and vs.confidence <> 'insufficient')");
    expect(sql).toContain('tv.version > 1');
    expect(sql).toContain('ti.version > 1');
  });

  it("stores the channel's normal NOW as its baseline, not a lifetime median", () => {
    const sql = norm(refreshChannelStatsSql(false));
    expect(sql).not.toContain('percentile_cont');
    expect(sql).toContain(norm(currentBaselineSql('c.channel_id')));
    // long-form only on THAT subquery: a Short's C(30) is not this channel's normal
    expect(sql).toContain('order by vb.published_at desc nulls last limit 1');
  });

  it('reports how many rows it wrote', async () => {
    mq.mockResolvedValue([{ channel_id: 'UC1' }, { channel_id: 'UC2' }]);
    await expect(refreshChannelStats()).resolves.toBe(2);
  });
});

describe('touchPackagingChange', () => {
  it('moves only the timestamp, and never backwards', async () => {
    await touchPackagingChange('UC1', new Date('2026-09-03T00:00:00.000Z'));
    const sql = norm(String(mq.mock.calls[0][0]));
    expect(sql).toContain('update channel_stats');
    expect(sql).toContain('greatest(last_packaging_change, $2::timestamptz)');
    // Never an insert: a stub row would read as video_count 0 on the channel list.
    expect(sql).not.toContain('insert');
    expect(sql).not.toContain('video_count');
    expect(mq.mock.calls[0][1]).toEqual(['UC1', '2026-09-03T00:00:00.000Z']);
  });

  it('is a no-op without a channel', async () => {
    await touchPackagingChange('', new Date());
    expect(mq).not.toHaveBeenCalled();
  });
});
