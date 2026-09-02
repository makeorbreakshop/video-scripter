import {
  addChannelMode, channelStats, roleLabel, backfillNote, usageView,
  markAlreadyTracked, addChannelError, MIN_SEARCH_LEN,
} from './channel-view';
import { PLANS } from './plans';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const row = (o: Partial<any> = {}) => ({
  channel_id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Chan', role: 'competitor', watched_closely: false,
  added_at: NOW.toISOString(), lane: 'user', backfill_status: null, thumbnail_url: null,
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
  it('distinguishes the user own channel', () => {
    expect(roleLabel('self')).toBe('YOUR CHANNEL');
    expect(roleLabel('competitor')).toBe('COMPETITOR');
  });
  it('only speaks up about backfill states that matter', () => {
    expect(backfillNote(row({ backfill_status: 'queued' }))).toBe('Back catalog queued');
    expect(backfillNote(row({ backfill_status: 'done' }))).toBeNull();
    expect(backfillNote(row())).toBeNull();
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
  });
});

describe('markAlreadyTracked', () => {
  it('marks results the user already has', () => {
    const out = markAlreadyTracked(
      [{ channel_id: 'UC1', name: 'a', video_count: 1, tracked_lane: 'corpus' },
       { channel_id: 'UC2', name: 'b', video_count: 2, tracked_lane: null }],
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
