import {
  nextCheck, reenter, launchUntilFor, changeAtFromLaunchUntil, parseRssTitles, titleCheckDue,
  FIXED_DAYS, RUN_INTERVAL_MIN, type Tier,
} from './launch-core';

const H = 3_600_000;
const D = 24 * H;
const pub = new Date('2026-09-01T12:00:00Z');

const M = 60_000;
const at = (h: number) => new Date(pub.getTime() + h * H);
// minutes until the next check, for a video of the given tier `h` hours after publish
const gap = (h: number, tier: Tier = 'standard', change_at: Date | null = null) => {
  const now = at(h);
  const r = nextCheck({ published_at: pub, change_at, tier, last_views: 10 }, now);
  return { phase: r.phase, min: (r.next_check.getTime() - now.getTime()) / M, next: r.next_check };
};

describe('log-spaced launch schedule', () => {
  test('standard ladder: 5 min to 1h, 15 min to 6h, 30 min to 24h', () => {
    expect(gap(0)).toMatchObject({ phase: 'launch', min: 5 });
    expect(gap(0.5).min).toBe(5);
    expect(gap(59 / 60).min).toBe(5); // 0:59
    expect(gap(61 / 60).min).toBe(15); // 1:01
    expect(gap(3).min).toBe(15);
    expect(gap(5 + 59 / 60).min).toBe(15); // 5:59
    expect(gap(6 + 1 / 60).min).toBe(30); // 6:01
    expect(gap(23 + 59 / 60).min).toBe(30); // 23:59
  });

  test('standard hands off to the fixed checkpoints at 24h', () => {
    const r = gap(24 + 1 / 60); // 24:01
    expect(r.phase).toBe('fixed');
    expect(r.next.getTime()).toBe(pub.getTime() + 2 * D);
    expect(gap(23 + 59 / 60).phase).toBe('launch');
  });

  test('dense ladder: 5 min to 2h, 15 min to 24h, 30-min shadow through day 3', () => {
    expect(gap(1.5, 'dense').min).toBe(5);
    expect(gap(1 + 59 / 60, 'dense').min).toBe(5); // 1:59
    expect(gap(2 + 1 / 60, 'dense').min).toBe(15); // 2:01
    expect(gap(6 + 1 / 60, 'dense').min).toBe(15); // still 15 where standard drops to 30
    expect(gap(23 + 59 / 60, 'dense').min).toBe(15);
    expect(gap(24 + 1 / 60, 'dense')).toMatchObject({ phase: 'launch', min: 30 });
    expect(gap(48, 'dense').min).toBe(30); // day 2 change lands with dense samples on both sides
    expect(gap(71 + 59 / 60, 'dense').min).toBe(30); // 71:59
    const after = gap(72 + 1 / 60, 'dense'); // 72:01 -> hands off to fixed
    expect(after.phase).toBe('fixed');
    expect(after.next.getTime()).toBe(pub.getTime() + 5 * D);
  });

  test('standard launch costs ~68 samples vs 96 at a flat 15 min', () => {
    let t = pub.getTime();
    let n = 0;
    for (;;) {
      const r = nextCheck({ published_at: pub, change_at: null, tier: 'standard', last_views: 10 }, new Date(t));
      if (r.phase !== 'launch') break;
      n++;
      t = r.next_check.getTime();
    }
    expect(n).toBe(68);
    expect(n).toBeLessThan(96);
  });

  test('fixed phase walks 2,3,5,7,14,30 and skips past days', () => {
    const now = new Date(pub.getTime() + 8 * D);
    const r = nextCheck({ published_at: pub, change_at: null, last_views: 10 }, now);
    expect(r.next_check.getTime()).toBe(pub.getTime() + 14 * D);
    expect(FIXED_DAYS[FIXED_DAYS.length - 1]).toBe(30);
  });

  test('catalog: weekly when small, daily when large', () => {
    const now = new Date(pub.getTime() + 40 * D);
    const small = nextCheck({ published_at: pub, change_at: null, last_views: 5_000 }, now);
    const large = nextCheck({ published_at: pub, change_at: null, last_views: 500_000 }, now);
    expect(small.phase).toBe('catalog');
    expect(small.next_check.getTime() - now.getTime()).toBe(7 * D);
    expect(large.next_check.getTime() - now.getTime()).toBe(1 * D);
  });

  test('launchUntilFor and RUN_INTERVAL_MIN match the 5-min LaunchAgent tick', () => {
    expect(launchUntilFor(pub).getTime()).toBe(pub.getTime() + 24 * H);
    expect(RUN_INTERVAL_MIN).toBe(5);
  });
});

describe('re-entry burst on a detected packaging change', () => {
  const change = new Date(pub.getTime() + 10 * D); // video is deep in fixed phase

  test('reenter marks a 24h window and an immediate check', () => {
    const r = reenter(change);
    expect(r.phase).toBe('launch');
    expect(r.launch_until.getTime() - change.getTime()).toBe(24 * H);
    expect(r.next_check.getTime()).toBe(change.getTime());
    expect(changeAtFromLaunchUntil(r.launch_until)!.getTime()).toBe(change.getTime());
  });

  test('burst overrides the sparser schedule: 5 min for 2h, then 15 min to 24h', () => {
    const g = (hAfterChange: number) => {
      const now = new Date(change.getTime() + hAfterChange * H);
      const r = nextCheck({ published_at: pub, change_at: change, tier: 'standard', last_views: 10 }, now);
      return { phase: r.phase, min: (r.next_check.getTime() - now.getTime()) / M, next: r.next_check };
    };
    expect(g(0)).toMatchObject({ phase: 'launch', min: 5 });
    expect(g(1 + 59 / 60).min).toBe(5);
    expect(g(2 + 1 / 60).min).toBe(15);
    expect(g(23 + 59 / 60).min).toBe(15);
    // hands back to the video's normal schedule (day 10 -> fixed day 14)
    const back = g(24 + 1 / 60);
    expect(back.phase).toBe('fixed');
    expect(back.next.getTime()).toBe(pub.getTime() + 14 * D);
  });

  test('a change during the launch window tightens, never loosens, the cadence', () => {
    const c = new Date(pub.getTime() + 8 * H); // standard would be on 30 min here
    expect(gap(8 + 1 / 60, 'standard').min).toBe(30);
    expect(gap(8 + 1 / 60, 'standard', c).min).toBe(5);
    expect(gap(11, 'standard', c).min).toBe(15); // 3h after the change
  });

  test('a change time in the future is ignored', () => {
    expect(gap(1.5, 'standard', new Date(pub.getTime() + 5 * H)).min).toBe(15);
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
