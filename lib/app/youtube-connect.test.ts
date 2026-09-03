jest.mock('../admin/db', () => ({ q: jest.fn(), one: jest.fn() }));
import { q } from '../admin/db';
import { buildAuthUrl, parseCallback, parseDailyRows, redirectUriFor, saveDaily, SAVE_BATCH, videosPerCall, YT_SCOPES } from './youtube-connect';

const mq = q as jest.Mock;
beforeEach(() => { mq.mockReset(); mq.mockResolvedValue([]); });

describe('buildAuthUrl', () => {
  it('asks for an offline grant with forced consent, both read scopes, and our state', () => {
    const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://localhost:3000/oauth-callback', state: 'abc' }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('state')).toBe('abc');
    expect(u.searchParams.get('scope')!.split(' ')).toEqual(YT_SCOPES);
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:3000/oauth-callback');
  });
  it('derives the callback from the request origin when nothing is configured', () => {
    delete process.env.YOUTUBE_REDIRECT_URI;
    expect(redirectUriFor('https://channelsmith.com/')).toBe('https://channelsmith.com/oauth-callback');
  });
  it('prefers the configured uri, because it must match the OAuth client exactly', () => {
    process.env.YOUTUBE_REDIRECT_URI = 'https://channelsmith.com/oauth-callback';
    // the live site serves from www, but the registered uri is the bare domain
    expect(redirectUriFor('https://www.channelsmith.com')).toBe('https://channelsmith.com/oauth-callback');
    delete process.env.YOUTUBE_REDIRECT_URI;
  });
});

describe('parseCallback', () => {
  const p = (s: string) => new URLSearchParams(s);
  it('accepts a code when the state matches the cookie', () => {
    expect(parseCallback(p('code=4/xyz&state=s1'), 's1')).toEqual({ ok: true, code: '4/xyz' });
  });
  it('rejects a mismatched or missing state (CSRF)', () => {
    expect(parseCallback(p('code=4/xyz&state=other'), 's1')).toEqual({ ok: false, reason: 'state' });
    expect(parseCallback(p('code=4/xyz&state=s1'), undefined)).toEqual({ ok: false, reason: 'state' });
  });
  it('reports a user denial and a missing code', () => {
    expect(parseCallback(p('error=access_denied&state=s1'), 's1')).toEqual({ ok: false, reason: 'denied' });
    expect(parseCallback(p('state=s1'), 's1')).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('parseDailyRows', () => {
  it('maps the API columns by header name, not position', () => {
    const rows = parseDailyRows({
      columnHeaders: [{ name: 'day' }, { name: 'video' }, { name: 'averageViewDuration' }, { name: 'views' }, { name: 'subscribersGained' }],
      rows: [['2026-09-01', 'abc', 312.5, '1200', 14]],
    });
    expect(rows).toEqual([expect.objectContaining({
      video_id: 'abc', date: '2026-09-01', views: 1200, average_view_duration: 312.5, subscribers_gained: 14,
      engaged_views: null, likes: 0,
    })]);
  });
  it('returns nothing when the video/day dimensions are absent', () => {
    expect(parseDailyRows({ columnHeaders: [{ name: 'views' }], rows: [[5]] })).toEqual([]);
  });
});

describe('saveDaily', () => {
  it('is a no-op for no rows and one multi-row upsert otherwise', async () => {
    expect(await saveDaily([])).toBe(0);
    expect(mq).not.toHaveBeenCalled();
    const row = { video_id: 'a', date: '2026-09-01', views: 1, engaged_views: null, estimated_minutes_watched: 2, average_view_duration: 3, average_view_percentage: 4, likes: 5, dislikes: 0, comments: 6, shares: 7, subscribers_gained: 8, subscribers_lost: 0 };
    expect(await saveDaily([row, { ...row, date: '2026-09-02' }])).toBe(2);
    expect(mq).toHaveBeenCalledTimes(1);
    const [sql, params] = mq.mock.calls[0];
    expect(sql).toMatch(/on conflict \(video_id, date\) do update/);
    expect(params).toHaveLength(26);
  });
  it('splits large loads into batches so one statement never exceeds the parameter cap', async () => {
    const row = { video_id: 'a', date: '2026-09-01', views: 1, engaged_views: null, estimated_minutes_watched: 2, average_view_duration: 3, average_view_percentage: 4, likes: 5, dislikes: 0, comments: 6, shares: 7, subscribers_gained: 8, subscribers_lost: 0 };
    const rows = Array.from({ length: SAVE_BATCH * 2 + 1 }, (_, i) => ({ ...row, video_id: `v${i}` }));
    expect(await saveDaily(rows)).toBe(rows.length);
    expect(mq).toHaveBeenCalledTimes(3);
    expect(mq.mock.calls[0][1]).toHaveLength(SAVE_BATCH * 13);
  });
});

describe('videosPerCall', () => {
  it('keeps videos x days under the 10,000-row report cap', () => {
    expect(videosPerCall(45) * 46).toBeLessThan(10000);
    expect(videosPerCall(400) * 401).toBeLessThan(10000);
    expect(videosPerCall(400)).toBe(22);
    expect(videosPerCall(1)).toBe(200);
  });
});
