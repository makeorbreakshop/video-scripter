jest.mock('../admin/db', () => ({ q: jest.fn() }));
import { q } from '../admin/db';
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

  it('keeps parity with the old inline listUserChannels aggregates, Shorts included', () => {
    const sql = norm(refreshChannelStatsSql(false));
    // Deliberately no longform predicate here: the channel list has always counted Shorts.
    expect(sql).not.toContain('shorts_checked_at');
    expect(sql).toContain('percentile_cont(0.5) within group (order by vs.baseline)');
    expect(sql).toContain("count(*) filter (where vs.score >= 2 and vs.confidence <> 'insufficient')");
    expect(sql).toContain('tv.version > 1');
    expect(sql).toContain('ti.version > 1');
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
