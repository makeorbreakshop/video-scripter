import { nextCheck, reenter, launchUntilFor, parseRssTitles, titleCheckDue, FIXED_DAYS } from './launch-core';

const H = 3_600_000;
const D = 24 * H;
const pub = new Date('2026-09-01T12:00:00Z');

describe('launch-window schedule', () => {
  test('inside launch window: every 15 minutes', () => {
    const now = new Date(pub.getTime() + 3 * H);
    const r = nextCheck({ published_at: pub, launch_until: launchUntilFor(pub), last_views: 10 }, now);
    expect(r.phase).toBe('launch');
    expect(r.next_check.getTime() - now.getTime()).toBe(15 * 60_000);
  });

  test('after launch window: next fixed day after publish', () => {
    const now = new Date(pub.getTime() + 25 * H);
    const r = nextCheck({ published_at: pub, launch_until: launchUntilFor(pub), last_views: 10 }, now);
    expect(r.phase).toBe('fixed');
    expect(r.next_check.getTime()).toBe(pub.getTime() + 2 * D);
  });

  test('fixed phase walks 2,3,5,7,14,30 and skips past days', () => {
    const now = new Date(pub.getTime() + 8 * D);
    const r = nextCheck({ published_at: pub, launch_until: null, last_views: 10 }, now);
    expect(r.next_check.getTime()).toBe(pub.getTime() + 14 * D);
    expect(FIXED_DAYS[FIXED_DAYS.length - 1]).toBe(30);
  });

  test('catalog: weekly when small, daily when large', () => {
    const now = new Date(pub.getTime() + 40 * D);
    const small = nextCheck({ published_at: pub, launch_until: null, last_views: 5_000 }, now);
    const large = nextCheck({ published_at: pub, launch_until: null, last_views: 500_000 }, now);
    expect(small.phase).toBe('catalog');
    expect(small.next_check.getTime() - now.getTime()).toBe(7 * D);
    expect(large.next_check.getTime() - now.getTime()).toBe(1 * D);
  });

  test('a packaging change re-opens a 24h launch window from now', () => {
    const now = new Date(pub.getTime() + 10 * D);
    const r = reenter(now);
    expect(r.phase).toBe('launch');
    expect(r.launch_until.getTime() - now.getTime()).toBe(24 * H);
    expect(r.next_check.getTime()).toBe(now.getTime());
  });

  test('title check is hourly', () => {
    const now = new Date();
    expect(titleCheckDue(null, now)).toBe(true);
    expect(titleCheckDue(new Date(now.getTime() - 30 * 60_000), now)).toBe(false);
    expect(titleCheckDue(new Date(now.getTime() - 61 * 60_000), now)).toBe(true);
  });
});

describe('parseRssTitles', () => {
  test('extracts id -> decoded title per entry', () => {
    const xml = `<feed><title>Chan</title><entry><yt:videoId>abc123XYZ_-</yt:videoId><title>A &amp; B &#39;c&#39;</title></entry>
      <entry><yt:videoId>def456UVW_-</yt:videoId><title>Plain</title></entry></feed>`;
    const m = parseRssTitles(xml);
    expect(m.get('abc123XYZ_-')).toBe("A & B 'c'");
    expect(m.get('def456UVW_-')).toBe('Plain');
    expect(m.size).toBe(2);
  });
});
