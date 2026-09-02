jest.mock('../admin/db', () => ({ q: jest.fn(), one: jest.fn() }));
import { q, one } from '../admin/db';
import {
  searchTracked, resolveChannel, trackChannel, untrackChannel,
  isShortOrLive, logQuota, quotaSpentToday, PlanLimitError, BACKFILL_DEPTH,
} from './channels';

const mq = q as jest.Mock;
const mone = one as jest.Mock;
const CH = 'UC4tAgeVdaNB5vD_mBoxg50w';

beforeEach(() => {
  mq.mockReset(); mone.mockReset();
  mq.mockResolvedValue([]);
  mone.mockResolvedValue(null);
  process.env.YOUTUBE_API_KEY = 'test-key';
  (global as any).fetch = jest.fn();
});

const sqlOf = (call: any[]) => String(call[0]).replace(/\s+/g, ' ');
const callsMatching = (re: RegExp) => mq.mock.calls.filter((c) => re.test(sqlOf(c)));

describe('logQuota', () => {
  it('writes the ledger and the daily rollup', async () => {
    await logQuota('app-resolve', 3);
    expect(callsMatching(/insert into quota_ledger/)[0][1]).toEqual(['app-resolve', 3]);
    expect(callsMatching(/youtube_quota_usage/)).toHaveLength(1);
  });
  it('is a no-op for zero units', async () => {
    await logQuota('app-resolve', 0);
    expect(mq).not.toHaveBeenCalled();
  });
  it('swallows database errors', async () => {
    mq.mockRejectedValue(new Error('down'));
    await expect(logQuota('app-resolve', 1)).resolves.toBeUndefined();
  });
});

describe('quotaSpentToday', () => {
  it('reads today\'s total for one category', async () => {
    mone.mockResolvedValue({ spent: '120' });
    await expect(quotaSpentToday('backfill')).resolves.toBe(120);
    mone.mockResolvedValue(null);
    await expect(quotaSpentToday('backfill')).resolves.toBe(0);
  });
});

describe('searchTracked', () => {
  it('ignores queries shorter than two characters', async () => {
    expect(await searchTracked('a')).toEqual([]);
    expect(await searchTracked(' ')).toEqual([]);
    expect(mq).not.toHaveBeenCalled();
  });
  it('runs a lowercased prefix match and caps the limit', async () => {
    mq.mockResolvedValue([{ channel_id: CH, name: 'Allrecipes', video_count: 10, tracked_lane: 'corpus' }]);
    await searchTracked('  AllRec ', 999);
    const [, params] = mq.mock.calls[0];
    expect(params).toEqual(['allrec%', 50]);
  });
  it('escapes LIKE wildcards in user input', async () => {
    await searchTracked('100%_off');
    expect(mq.mock.calls[0][1][0]).toBe('100\\%\\_off%');
  });
});

describe('resolveChannel', () => {
  const channelItem = {
    id: CH,
    snippet: { title: 'Allrecipes', customUrl: '@allrecipes', thumbnails: { high: { url: 'http://t/x.jpg' } } },
    statistics: { subscriberCount: '1000000', videoCount: '5000' },
    contentDetails: { relatedPlaylists: { uploads: 'UU4tAgeVdaNB5vD_mBoxg50w' } },
  };

  it('resolves an id for one unit and logs it', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ items: [channelItem] }) });
    mone.mockResolvedValue({ known: true });
    const r = await resolveChannel({ kind: 'id', value: CH });
    expect(r).toMatchObject({ channel_id: CH, name: 'Allrecipes', units: 1, known: true });
    expect(callsMatching(/quota_ledger/)[0][1]).toEqual(['app-resolve', 1]);
  });

  it('resolves a handle via forHandle', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ items: [channelItem] }) });
    await resolveChannel({ kind: 'handle', value: '@allrecipes' });
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('forHandle=allrecipes');
  });

  it('resolves a video in two units (videos.list then channels.list)', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ snippet: { channelId: CH } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [channelItem] }) });
    const r = await resolveChannel({ kind: 'video', value: 'dQw4w9WgXcQ' });
    expect(r!.units).toBe(2);
    expect(callsMatching(/quota_ledger/)[0][1]).toEqual(['app-resolve', 2]);
  });

  it('returns null for a search ref without spending quota', async () => {
    await expect(resolveChannel({ kind: 'search', value: 'lasers' })).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(callsMatching(/quota_ledger/)).toHaveLength(0);
  });

  it('returns null when the channel does not exist', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    await expect(resolveChannel({ kind: 'handle', value: '@nope' })).resolves.toBeNull();
  });

  it('still logs the unit when the API errors', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 403, text: async () => 'quota' });
    await expect(resolveChannel({ kind: 'id', value: CH })).rejects.toThrow('403');
    expect(callsMatching(/quota_ledger/)[0][1]).toEqual(['app-resolve', 1]);
  });
});

describe('isShortOrLive', () => {
  it('rejects sub-63-second videos, live and upcoming', () => {
    expect(isShortOrLive({ contentDetails: { duration: 'PT58S' } })).toBe(true);
    expect(isShortOrLive({ contentDetails: { duration: 'PT1M2S' } })).toBe(true);
    expect(isShortOrLive({ contentDetails: { duration: 'PT10M' }, snippet: { liveBroadcastContent: 'live' } })).toBe(true);
    expect(isShortOrLive({ snippet: { liveBroadcastContent: 'upcoming' } })).toBe(true);
  });
  it('keeps longform', () => {
    expect(isShortOrLive({ contentDetails: { duration: 'PT1M3S' }, snippet: { liveBroadcastContent: 'none' } })).toBe(false);
    expect(isShortOrLive({ contentDetails: { duration: 'PT1H2M' } })).toBe(false);
  });
});

describe('trackChannel', () => {
  // planUsage/isKnownChannel/already-tracked all read through `one`.
  function stubOne({ already = false, plan = 'free', tracked = 0, watched = 0, known = true }) {
    mone.mockImplementation(async (sql: string) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (s.includes('from user_channels where user_id')) return already ? { x: 1 } : null;
      if (s.includes('from app_users u')) return { plan, tracked: String(tracked), watched: String(watched) };
      if (s.includes('as known')) return { known };
      return null;
    });
  }

  it('rejects a non-channel-id', async () => {
    await expect(trackChannel('u1', 'garbage')).rejects.toThrow('not a channel id');
  });

  it('refuses a third channel on the free plan', async () => {
    stubOne({ tracked: 2 });
    await expect(trackChannel('u1', CH)).rejects.toBeInstanceOf(PlanLimitError);
    expect(callsMatching(/insert into user_channels/)).toHaveLength(0);
  });

  it('allows re-tracking a channel the user already has, even at the limit', async () => {
    stubOne({ already: true, tracked: 2 });
    await expect(trackChannel('u1', CH)).resolves.toMatchObject({ channel_id: CH });
  });

  it('refuses a second watched-closely slot on the free plan', async () => {
    stubOne({ tracked: 1, watched: 1 });
    await expect(trackChannel('u1', CH, 'competitor', { watchedClosely: true }))
      .rejects.toBeInstanceOf(PlanLimitError);
  });

  it('upserts the membership, promotes the lane and queues both jobs', async () => {
    stubOne({ known: true });
    mq.mockImplementation(async (sql: string) => {
      if (/insert into backfill_jobs/.test(String(sql))) return [{ id: '1' }];
      return [];
    });
    const r = await trackChannel('u1', CH, 'self');
    expect(r).toMatchObject({ role: 'self', lane: 'user', enrolled: false, jobs_queued: 2 });

    expect(callsMatching(/insert into user_channels/)[0][1]).toEqual(['u1', CH, 'self', false]);
    const promote = callsMatching(/insert into channel_tracking/)[0];
    expect(promote[1]).toEqual([CH, BACKFILL_DEPTH]);
    expect(sqlOf(promote)).toContain("lane = 'user'");
    const kinds = callsMatching(/insert into backfill_jobs/).map((c) => c[1][1]);
    expect(kinds).toEqual(['catalog', 'snapshots']);
  });

  it('enrolls and fast-syncs a channel we have never seen', async () => {
    stubOne({ known: false });
    mq.mockImplementation(async (sql: string) => {
      if (/insert into backfill_jobs/.test(String(sql))) return [{ id: '1' }];
      if (/select id from videos where id = any/.test(String(sql))) return [];
      return [];
    });
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes('/channels?')) return { ok: true, json: async () => ({ items: [{ id: CH, snippet: { title: 'Allrecipes' }, statistics: {} }] }) };
      if (url.includes('feeds/videos.xml')) return { ok: true, text: async () => '<feed><entry><yt:videoId>abcdefghijk</yt:videoId></entry></feed>' };
      if (url.includes('/videos?')) return { ok: true, json: async () => ({ items: [{ id: 'abcdefghijk', snippet: { title: 'T', channelId: CH, publishedAt: '2026-01-01T00:00:00Z' }, statistics: { viewCount: '5' }, contentDetails: { duration: 'PT10M' } }] }) };
      return { ok: false, status: 404, text: async () => '' };
    });

    const r = await trackChannel('u1', CH);
    expect(r.enrolled).toBe(true);
    expect(r.fast_synced).toBe(1);
    expect(callsMatching(/insert into discovered_channels/)).toHaveLength(1);
    expect(sqlOf(callsMatching(/insert into videos/)[0])).toContain('on conflict (id) do nothing');
    expect(callsMatching(/insert into view_snapshots/)).toHaveLength(1);
  });
});

describe('untrackChannel', () => {
  it('reports nothing removed when the user did not track it', async () => {
    mq.mockResolvedValue([]);
    await expect(untrackChannel('u1', CH)).resolves.toEqual({ removed: false, demoted: false });
  });

  it('keeps the user lane while another user still tracks the channel', async () => {
    mq.mockImplementation(async (sql: string) =>
      /delete from user_channels/.test(String(sql)) ? [{ channel_id: CH }] : []);
    mone.mockResolvedValue({ n: '1' });
    await expect(untrackChannel('u1', CH)).resolves.toEqual({ removed: true, demoted: false });
    expect(callsMatching(/update channel_tracking/)).toHaveLength(0);
  });

  it('demotes to corpus and cancels queued backfill when nobody is left', async () => {
    mq.mockImplementation(async (sql: string) =>
      /delete from user_channels/.test(String(sql)) ? [{ channel_id: CH }] : []);
    mone.mockResolvedValue({ n: '0' });
    await expect(untrackChannel('u1', CH)).resolves.toEqual({ removed: true, demoted: true });
    expect(sqlOf(callsMatching(/update channel_tracking/)[0])).toContain("lane = 'corpus'");
    expect(sqlOf(callsMatching(/update backfill_jobs/)[0])).toContain("error = 'untracked'");
  });
});
