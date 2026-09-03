import {
  addChannelMode, channelStats, roleLabel, planLabel, usageView,
  markAlreadyTracked, addChannelError, MIN_SEARCH_LEN, avatarAt, pickerMeta,
} from './channel-view';
import { PLANS } from './plans';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const row = (o: Partial<any> = {}) => ({
  channel_id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Chan', role: 'competitor', watched_closely: false,
  added_at: NOW.toISOString(), lane: 'user', backfill_status: null, thumbnail_url: null, avatar_url: null,
  video_count: 1240, baseline: 52000, outliers: 3, last_packaging_change: null, ...o,
});

describe('addChannelMode', () => {
  it('waits until there is something to act on', () => {
    expect(addChannelMode('')).toBe('idle');
    expect(addChannelMode('a')).toBe('idle');
    expect('ab'.length).toBe(MIN_SEARCH_LEN);
  });
  it('searches free text and resolves anything that identifies a channel', () => {
    expect(addChannelMode('make or break shop')).toBe('search');
    expect(addChannelMode('@makeorbreakshop')).toBe('resolve');
    expect(addChannelMode('https://youtube.com/channel/UC4tAgeVdaNB5vD_mBoxg50w')).toBe('resolve');
    expect(addChannelMode('UC4tAgeVdaNB5vD_mBoxg50w')).toBe('resolve');
    expect(addChannelMode('https://youtu.be/dQw4w9WgXcQ')).toBe('resolve');
  });
});

describe('channelStats', () => {
  it('formats the four headline numbers', () => {
    expect(channelStats(row(), NOW).map((s) => s.value)).toEqual(['1.2K', '52K', '3', '—']);
  });
  it('shows how long ago packaging last moved', () => {
    const at = new Date(NOW.getTime() - 3 * 86400_000).toISOString();
    expect(channelStats(row({ last_packaging_change: at }), NOW)[3].value).toBe('3d ago');
  });
  it('renders a missing baseline rather than zero', () => {
    expect(channelStats(row({ baseline: null }), NOW)[1].value).toBe('—');
  });
});

describe('labels', () => {
  it('names the two roles in plain words, with no lane or tier language', () => {
    expect(roleLabel('self')).toBe('Your channel');
    expect(roleLabel('competitor')).toBe('Competitor');
  });
  it('capitalises the plan for display', () => {
    expect(planLabel('owner')).toBe('Owner');
    expect(planLabel('pro')).toBe('Pro');
    expect(planLabel('free')).toBe('Free');
    expect(planLabel('nonsense')).toBe('Free');
  });
});

describe('usageView', () => {
  it('reports free-plan usage and flags the limit', () => {
    const v = usageView('free', PLANS.free, { tracked: 2, watched_closely: 0 });
    expect(v.tracked).toBe('2 / 2');
    expect(v.atTrackedLimit).toBe(true);
    expect(v.atWatchedLimit).toBe(false);
    expect(v.trackedPct).toBe(100);
  });
  it('is not at the limit with room to spare', () => {
    const v = usageView('pro', PLANS.pro, { tracked: 5, watched_closely: 1 });
    expect(v.atTrackedLimit).toBe(false);
    expect(v.trackedPct).toBe(20);
    expect(v.unlimited).toBe(false);
  });
  it('never renders Infinity or a stuck meter on the unlimited plan', () => {
    const v = usageView('owner', PLANS.owner, { tracked: 3, watched_closely: 2 });
    expect(v.tracked).toBe('3 · unlimited');
    expect(v.watched).toBe('2 · unlimited');
    expect(v.tracked).not.toMatch(/Infinity/);
    expect(v.atTrackedLimit).toBe(false);
    expect(v.unlimited).toBe(true);
    expect(v.trackedPct).toBe(0);
  });
});

describe('markAlreadyTracked', () => {
  it('marks results the user already has', () => {
    const out = markAlreadyTracked(
      [{ channel_id: 'UC1', name: 'a', video_count: 1, tracked_lane: 'corpus', avatar_url: null },
       { channel_id: 'UC2', name: 'b', video_count: 2, tracked_lane: null, avatar_url: null }],
      ['UC2']
    );
    expect(out.map((r) => r.already)).toEqual([false, true]);
  });
  it('tolerates an empty result set', () => {
    expect(markAlreadyTracked([], [])).toEqual([]);
  });
});

describe('addChannelError', () => {
  it('surfaces the plan-limit message from the API', () => {
    expect(addChannelError(402, { error: 'Your free plan tracks 2 channels.' })).toMatch(/free plan/);
  });
  it('has a readable fallback for every failure', () => {
    expect(addChannelError(402, null)).toMatch(/plan limit/i);
    expect(addChannelError(404, null)).toMatch(/No channel/);
    expect(addChannelError(503, null)).toMatch(/rate limiting/);
    expect(addChannelError(401, null)).toMatch(/session expired/i);
    expect(addChannelError(500, null)).toMatch(/went wrong/);
  });
});

describe('avatarAt', () => {
  it('asks YouTube for a small avatar instead of the 800px original', () => {
    expect(avatarAt('https://yt3.ggpht.com/ytc/AIdro_k=s800-c-k-c0x00ffffff-no-rj', 64))
      .toBe('https://yt3.ggpht.com/ytc/AIdro_k=s64-c-k-c0x00ffffff-no-rj');
  });
  it('leaves other hosts and nulls alone', () => {
    expect(avatarAt('https://example.com/a.jpg', 64)).toBe('https://example.com/a.jpg');
    expect(avatarAt(null, 64)).toBeNull();
  });
});

describe('pickerMeta', () => {
  const base = { channel_id: 'UC1', name: 'Captain Steeeve', video_count: 49, tracked_lane: 'corpus', handle: 'captainsteeeve', subscriber_count: 1_240_000 };
  it('shows handle, subscribers and videos; nothing about our internals', () => {
    expect(pickerMeta(base)).toBe('@captainsteeeve · 1.2M subscribers · 49 videos');
  });
  it('accepts the string a bigint column comes back as', () => {
    expect(pickerMeta({ ...base, subscriber_count: '1150000' as any })).toBe('@captainsteeeve · 1.2M subscribers · 49 videos');
  });
  it('skips what we do not know', () => {
    expect(pickerMeta({ ...base, handle: null, subscriber_count: null })).toBe('49 videos');
  });
  it('tells the user a brand-new channel will be synced after adding', () => {
    expect(pickerMeta({ ...base, tracked_lane: null, video_count: 0 })).toBe('@captainsteeeve · 1.2M subscribers · new to us, synced after you add it');
  });
});
