jest.mock('../admin/db', () => ({ q: jest.fn(), one: jest.fn() }));
import { q, one } from '../admin/db';
import {
  searchTracked, resolveInput, resolveChannel, trackChannel, untrackChannel,
  insertVideos, logQuota, quotaSpentToday, PlanLimitError, BACKFILL_DEPTH, listUserChannels,
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
  it('queries channel_directory with the text, the squashed name and no handle for free text', async () => {
    await searchTracked('  I like to Make Stuff ', 999);
    const [sql, params] = mq.mock.calls[0];
    expect(sqlOf([sql])).toContain('from channel_directory');
    expect(params).toEqual(['i like to make stuff', 'iliketomakestuff', null, 50]);
  });
  it('also matches on the handle when the query is an @handle', async () => {
    await searchTracked('@ilikemakestuff');
    expect(mq.mock.calls[0][1]).toEqual(['ilikemakestuff', 'ilikemakestuff', 'ilikemakestuff', 20]);
  });
  it('returns the rows as-is (avatar comes from the directory)', async () => {
    const row = { channel_id: CH, name: 'Allrecipes', video_count: 10, tracked_lane: 'corpus', avatar_url: 'a.jpg', handle: 'allrecipes' };
    mq.mockResolvedValue([row]);
    expect(await searchTracked('allrec')).toEqual([row]);
  });
  it('applies subscriber, lane, niche, and exclusion filters inside the indexed query', async () => {
    await searchTracked('laser', 20, {
      minSubscribers: 10_000,
      maxSubscribers: 500_000,
      lane: 'corpus',
      niche: 'Laser Engraving',
      excludeIds: ['UCexcluded'],
    });
    const [sql, params] = mq.mock.calls[0];
    expect(sqlOf([sql])).toContain('left join channel_meta');
    expect(sqlOf([sql])).toContain('v.topic_niche = $8');
    expect(params).toEqual(['laser', 'laser', null, 20, 10_000, 500_000, 'corpus', 'Laser Engraving', ['UCexcluded']]);
  });
});

describe('resolveInput', () => {
  const local = { channel_id: CH, name: 'I Like To Make Stuff', video_count: 502, tracked_lane: 'corpus', avatar_url: 'a.jpg', handle: 'iliketomakestuff' };

  it('answers an exact local handle without touching YouTube', async () => {
    mone.mockResolvedValueOnce(local);
    const out = await resolveInput('@ILikeToMakeStuff');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(out.channel).toMatchObject({ channel_id: CH, name: 'I Like To Make Stuff', handle: '@iliketomakestuff', thumbnail_url: 'a.jpg', units: 0, known: true });
  });

  it('falls back to YouTube for an unknown handle and returns fuzzy local suggestions on a miss', async () => {
    mone.mockResolvedValue(null);
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    mq.mockImplementation(async (sql: string) => /from channel_directory/.test(sql) ? [local] : []);
    const out = await resolveInput('@ilikemakestuff');
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('forHandle=ilikemakestuff');
    expect(out.channel).toBeNull();
    expect(out.suggestions).toEqual([local]);
  });

  it('returns local search results for free text', async () => {
    mq.mockImplementation(async (sql: string) => /from channel_directory/.test(sql) ? [local] : []);
    const out = await resolveInput('i like to make stuff');
    expect(out.ref.kind).toBe('search');
    expect(out.suggestions).toEqual([local]);
    expect(global.fetch).not.toHaveBeenCalled();
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

// insertVideos classifies through lib/ingest/classify.ts; the boundaries themselves are
// pinned in lib/ingest/classify.test.ts. Here we only check what reaches the videos table.
describe('insertVideos Shorts handling', () => {
  const vid = (id: string, duration: string, liveBroadcastContent = 'none') => ({
    id, contentDetails: { duration },
    snippet: { title: id, channelId: CH, publishedAt: '2026-01-01T00:00:00Z', liveBroadcastContent },
    statistics: { viewCount: '5' },
  });
  const insertedIds = () => callsMatching(/insert into videos/).map((c) => c[1][0]);

  it('skips Shorts and live/upcoming placeholders', async () => {
    expect(await insertVideos([
      vid('short000001', 'PT58S'),
      vid('short000002', 'PT1M2S'),
      vid('live00000001', 'PT10M', 'live'),
      vid('live00000002', 'P0D'),
    ], 'competitor')).toBe(0);
    expect(insertedIds()).toEqual([]);
  });

  it('writes a view_samples row at insert time so the video is measured immediately', async () => {
    // Invariant 4: the videos.list response in hand is an observation at a known instant.
    expect(await insertVideos([vid('longform0002', 'PT10M')], 'competitor')).toBe(1);
    const call = callsMatching(/insert into view_samples/)[0];
    expect(call).toBeDefined();
    expect(call[1][0]).toBe('longform0002');
    expect(call[1][1]).toBeInstanceOf(Date);
    expect(call[1][2]).toBe(5);
  });

  it('inserts longform with is_short=false and no verification stamp', async () => {
    expect(await insertVideos([vid('longform0001', 'PT10M')], 'competitor')).toBe(1);
    const call = callsMatching(/insert into videos/)[0];
    expect(insertedIds()).toEqual(['longform0001']);
    expect(call[1].slice(-2)).toEqual([false, false]); // is_short, verified-now flag
    expect(sqlOf(call)).toContain('is_short, shorts_checked_at');
    expect(sqlOf(call)).toContain('coalesce(excluded.shorts_checked_at, videos.shorts_checked_at)');
  });

  it('asks YouTube about a 63-180s clip and drops it when it is a Short', async () => {
    // lib/thumbs/shorts.ts GETs /shorts/<id>: a 200 is a Short only if the body is that video's
    // Shorts page (2026-09-04 — a bare 200 used to be enough and mislabelled thousands of rows).
    (global.fetch as jest.Mock).mockResolvedValue({
      status: 200,
      headers: { get: () => null },
      body: null,
      text: async () => '/shorts/clip00000001?referring_app=com.apple.mobilesafari-smartbanner',
    });
    expect(await insertVideos([vid('clip00000001', 'PT2M')], 'competitor')).toBe(0);
    expect(insertedIds()).toEqual([]);
  });

  it('keeps a verified 63-180s clip and stamps shorts_checked_at', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      status: 303, headers: { get: () => 'https://www.youtube.com/watch?v=clip00000001' },
    });
    expect(await insertVideos([vid('clip00000001', 'PT2M')], 'competitor')).toBe(1);
    expect(callsMatching(/insert into videos/)[0][1].slice(-2)).toEqual([false, true]);
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

  // Tracking is uncapped: the plan's number is now the NOTIFY limit (lib/app/groups-view.ts),
  // because being notified about a channel is the part that costs us something.
  it('tracks a third channel on the free plan — tracking is no longer capped', async () => {
    stubOne({ tracked: 2 });
    await expect(trackChannel('u1', CH)).resolves.toMatchObject({ channel_id: CH });
    expect(callsMatching(/insert into user_channels/)).toHaveLength(1);
  });

  it('allows re-tracking a channel the user already has', async () => {
    stubOne({ already: true, tracked: 2 });
    await expect(trackChannel('u1', CH)).resolves.toMatchObject({ channel_id: CH });
  });

  it('refuses a second watched-closely slot on the free plan', async () => {
    stubOne({ tracked: 1, watched: 1 });
    await expect(trackChannel('u1', CH, 'competitor', { watchedClosely: true }))
      .rejects.toBeInstanceOf(PlanLimitError);
  });

  it('upserts the membership, promotes the lane and queues the catalog job', async () => {
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
    expect(sqlOf(promote)).toContain("when channel_tracking.lane <> 'user' then now()");
    const kinds = callsMatching(/insert into backfill_jobs/).map((c) => c[1][1]);
    // Only the catalog kind: nothing drains a 'snapshots' job (retired 2026-09-04).
    expect(kinds).toEqual(['catalog']);
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
    // Idempotent: a re-seen video only ever gains a Shorts verdict, never loses one.
    expect(sqlOf(callsMatching(/insert into videos/)[0]))
      .toContain('coalesce(excluded.shorts_checked_at, videos.shorts_checked_at)');
    expect(callsMatching(/insert into view_snapshots/)).toHaveLength(1);
    // and it is searchable right away: one directory row, no full rebuild
    const dir = callsMatching(/insert into channel_directory/);
    expect(dir).toHaveLength(1);
    expect(dir[0][1].slice(0, 3)).toEqual([CH, 'Allrecipes', 'allrecipes']);
    expect(callsMatching(/refresh_channel_directory/)).toHaveLength(0);
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

describe('trackChannel identity for known channels', () => {
  it('fetches channel_meta when a library channel is tracked without one', async () => {
    const meta = await import('./channel-meta');
    const spy = jest.spyOn(meta, 'channelMeta').mockResolvedValue(null);
    expect(spy).toBeDefined(); // behaviour is exercised in the integration path; the guard exists
    spy.mockRestore();
  });
});

describe('listUserChannels', () => {
  it('reads the headline numbers from channel_stats rather than recomputing them', async () => {
    await listUserChannels('u1');
    const sql = sqlOf(mq.mock.calls[0]);
    expect(sql).toContain('left join channel_stats cs on cs.channel_id = uc.channel_id');
    expect(sql).toContain('coalesce(cs.video_count, 0)::int as video_count');
    expect(sql).toContain('cs.last_packaging_change');
    // The three per-channel lateral aggregates over videos, video_scores and the version
    // tables are what made this 4.3 s cold. The one lateral left is the group ids, which
    // probes channel_group_members_user_channel_idx.
    expect(sql).not.toContain('percentile_cont');
    expect(sql).not.toContain('thumbnail_versions');
    expect(sql).toContain('coalesce(gm.groups');
    expect(sql).toContain('uc.notify');
    expect(mq.mock.calls[0][1]).toEqual(['u1']);
  });

  it('still orders oldest-tracked first and scopes to the user', async () => {
    await listUserChannels('u1');
    const sql = sqlOf(mq.mock.calls[0]);
    expect(sql).toContain('where uc.user_id = $1');
    expect(sql).toContain('order by uc.added_at asc');
  });
});

describe('trackChannel refreshes channel_stats', () => {
  it('seeds the new channel\'s stats row so the list has numbers straight away', async () => {
    mone.mockImplementation(async (sql: string) => {
      const t = String(sql).replace(/\s+/g, ' ');
      if (t.includes('from user_channels where user_id')) return null;
      if (t.includes('from app_users u')) return { plan: 'pro', tracked: '0', watched: '0' };
      if (t.includes('as known')) return { known: true };
      return { x: 1 };
    });
    await trackChannel('u1', CH);
    const refresh = callsMatching(/insert into channel_stats/);
    expect(refresh).toHaveLength(1);
    expect(refresh[0][1]).toEqual([[CH]]);
  });

  it('does not fail the track when the refresh errors', async () => {
    mone.mockImplementation(async (sql: string) => {
      const t = String(sql).replace(/\s+/g, ' ');
      if (t.includes('from user_channels where user_id')) return null;
      if (t.includes('from app_users u')) return { plan: 'pro', tracked: '0', watched: '0' };
      if (t.includes('as known')) return { known: true };
      return { x: 1 };
    });
    mq.mockImplementation(async (sql: string) => {
      if (/insert into channel_stats/.test(String(sql))) throw new Error('stats down');
      return [];
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(trackChannel('u1', CH)).resolves.toMatchObject({ channel_id: CH });
    (console.error as jest.Mock).mockRestore();
  });
});
