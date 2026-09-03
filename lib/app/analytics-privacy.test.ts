jest.mock('../admin/db', () => ({ q: jest.fn(), one: jest.fn() }));
import { q, one } from '../admin/db';
import { ownsChannel, privateAnalytics, deleteChannelData, forgetUser } from './analytics-privacy';

const mq = q as jest.Mock, mone = one as jest.Mock;
const USER = '60945b47-6237-4575-b2fb-93d2a894585b';
const CH = 'UCjWkNxpp3UHdEavpM_19--Q';
const sqlOf = (call: any[]) => String(call[0]).replace(/\s+/g, ' ');

beforeEach(() => { mq.mockReset(); mone.mockReset(); mq.mockResolvedValue([]); mone.mockResolvedValue(null); });

describe('ownsChannel', () => {
  it('is true only when this user has a live connection for the channel', async () => {
    mone.mockResolvedValue({ x: 1 });
    await expect(ownsChannel(USER, CH)).resolves.toBe(true);
    expect(mone.mock.calls[0][1]).toEqual([USER, CH]);
    mone.mockResolvedValue(null);
    await expect(ownsChannel(USER, CH)).resolves.toBe(false);
  });
});

describe('privateAnalytics', () => {
  it('returns nothing and touches no data when the user does not own the channel', async () => {
    mone.mockResolvedValue(null); // not owned
    await expect(privateAnalytics(USER, CH)).resolves.toEqual([]);
    expect(mq).not.toHaveBeenCalled();
  });

  it('scopes every read by both the channel and the caller, never by channel alone', async () => {
    mone.mockResolvedValue({ x: 1 });
    mq.mockResolvedValue([{ video_id: 'v', date: '2026-09-01' }]);
    await privateAnalytics(USER, CH, { from: '2026-08-01', to: '2026-09-01' });
    const sql = sqlOf(mq.mock.calls[0]);
    expect(sql).toMatch(/from daily_analytics/);
    expect(sql).toMatch(/youtube_connections/);        // ownership is enforced in the query itself
    expect(mq.mock.calls[0][1]).toEqual([USER, CH, '2026-08-01', '2026-09-01']);
  });

  it('rejects a blank user id rather than running an unscoped query', async () => {
    await expect(privateAnalytics('', CH)).rejects.toThrow(/user/i);
    expect(mq).not.toHaveBeenCalled();
  });
});

describe('deleteChannelData', () => {
  it('refuses when the caller does not own the channel', async () => {
    mone.mockResolvedValue(null);
    await expect(deleteChannelData(USER, CH)).rejects.toThrow(/not connected/i);
    expect(mq).not.toHaveBeenCalled();
  });

  it('removes the analytics rows and the grant, and reports what went', async () => {
    mone.mockResolvedValue({ x: 1 });
    mq.mockResolvedValueOnce([{ n: 1200 }]).mockResolvedValueOnce([]);
    const out = await deleteChannelData(USER, CH);
    expect(sqlOf(mq.mock.calls[0])).toMatch(/delete from daily_analytics/);
    expect(sqlOf(mq.mock.calls[1])).toMatch(/delete from youtube_connections/);
    expect(out).toEqual({ analytics_rows: 1200, disconnected: true });
  });
});

describe('forgetUser', () => {
  it('walks every channel the user connected so nothing is orphaned', async () => {
    mq.mockResolvedValueOnce([{ channel_id: CH }, { channel_id: 'UCother' }]);
    mone.mockResolvedValue({ x: 1 });
    mq.mockResolvedValue([{ n: 5 }]);
    const out = await forgetUser(USER);
    expect(out.channels).toBe(2);
  });
});
