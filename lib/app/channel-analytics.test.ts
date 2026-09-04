jest.mock('../admin/db', () => ({ q: jest.fn(), one: jest.fn() }));
import { q } from '../admin/db';
import {
  channelBaselineSeries, hasBaselineLine, baselineDomain, timeTicks, tickFormat, timeExtent,
  markKind, nearestByX, MARK_HEIGHT, MIN_BASELINE_POINTS,
  type BaselinePoint,
} from './channel-analytics';

const mq = q as jest.Mock;
beforeEach(() => { mq.mockReset(); mq.mockResolvedValue([]); });

const row = (over: Partial<Record<string, any>> = {}) => ({
  id: 'v1', title: 'A video', published_at: '2026-01-10T12:00:00Z',
  baseline: 50000, est30: 120000, score: 2.4, confidence: 'high', ...over,
});
const pt = (over: Partial<BaselinePoint> = {}): BaselinePoint => ({
  videoId: 'v', title: 't', t: 0, publishedAt: '2026-01-01T00:00:00Z',
  baseline: 100, est30: 200, score: 2, weak: false, ...over,
});

describe('channelBaselineSeries', () => {
  it('never reads video_scores without the channel predicate', async () => {
    await channelBaselineSeries('UC123', '1y');
    const [sql, params] = mq.mock.calls[0];
    expect(sql).toMatch(/join video_scores/);
    expect(sql).toMatch(/where v\.channel_id = \$1/);
    expect(params).toEqual(['UC123']);
  });

  it('takes the recent tail off the index and hands it back oldest-first', async () => {
    mq.mockResolvedValue([
      row({ id: 'new', published_at: '2026-03-01T00:00:00Z' }),
      row({ id: 'old', published_at: '2026-01-01T00:00:00Z' }),
    ]);
    const s = await channelBaselineSeries('UC123');
    expect(mq.mock.calls[0][0]).toMatch(/order by v\.published_at desc/);
    expect(s.map((p) => p.videoId)).toEqual(['old', 'new']);
    expect(s[0].t).toBeLessThan(s[1].t);
  });

  it('bounds the read and keeps long-form only', async () => {
    await channelBaselineSeries('UC123', 'all');
    const sql = mq.mock.calls[0][0];
    expect(sql).toMatch(/limit \d+/);
    expect(sql).toMatch(/is_short/);
    expect(sql).not.toMatch(/published_at >= now\(\)/);
  });

  it('applies the range as an interval when there is one', async () => {
    await channelBaselineSeries('UC123', '90d');
    expect(mq.mock.calls[0][0]).toMatch(/interval '90 days'/);
  });

  it('marks an unbacked score weak and drops its number, but keeps the video', async () => {
    mq.mockResolvedValue([row({ confidence: 'insufficient' }), row({ id: 'v2', confidence: null })]);
    const s = await channelBaselineSeries('UC123');
    for (const p of s) {
      expect(p.weak).toBe(true);
      expect(p.score).toBeNull();
      expect(p.est30).toBe(120000);
    }
  });

  it('treats zero and null views as absent — a log axis cannot draw either', async () => {
    mq.mockResolvedValue([row({ baseline: 0, est30: null })]);
    const [p] = await channelBaselineSeries('UC123');
    expect(p.baseline).toBeNull();
    expect(p.est30).toBeNull();
  });
});

describe('hasBaselineLine', () => {
  it('counts baselines, not rows', () => {
    const scoredButNoBaseline = Array.from({ length: 20 }, () => pt({ baseline: null }));
    expect(hasBaselineLine(scoredButNoBaseline)).toBe(false);
    expect(hasBaselineLine(Array.from({ length: MIN_BASELINE_POINTS }, () => pt()))).toBe(true);
    expect(hasBaselineLine(Array.from({ length: MIN_BASELINE_POINTS - 1 }, () => pt()))).toBe(false);
  });
});

describe('baselineDomain', () => {
  it('stays strictly positive so the log axis has a floor it can draw', () => {
    const [lo, hi] = baselineDomain([pt({ baseline: 1 })]);
    expect(lo).toBeGreaterThanOrEqual(1);
    expect(hi).toBeGreaterThan(lo);
    expect(baselineDomain([])[0]).toBeGreaterThanOrEqual(1);
  });
  it('covers the line and ignores the videos — est30 is not on this axis', () => {
    const [lo, hi] = baselineDomain([pt({ baseline: 1000, est30: 4_000_000 })]);
    expect(lo).toBeLessThan(1000);
    expect(hi).toBeLessThan(4_000_000);
  });
  it('ignores points with no baseline', () => {
    expect(baselineDomain([pt({ baseline: null }), pt({ baseline: 500 })])[1])
      .toBeCloseTo(500 * 1.6);
  });
});

describe('timeTicks', () => {
  it('spans the range without crowding the axis', () => {
    const pts = Array.from({ length: 40 }, (_, i) => pt({ t: i * 86_400_000 }));
    const ticks = timeTicks(pts, 5);
    expect(ticks).toHaveLength(5);
    expect(ticks[0]).toBe(pts[0].t);
    expect(ticks[4]).toBe(pts[39].t);
  });
  it('degrades to the points themselves when there is barely a range', () => {
    expect(timeTicks([])).toEqual([]);
    expect(timeTicks([pt({ t: 5 })])).toEqual([5]);
    expect(timeTicks([pt({ t: 5 }), pt({ t: 5 })])).toEqual([5]);
  });
});

describe('tickFormat', () => {
  const day = 86_400_000;
  it('names the month over a year and the day over a season', () => {
    const span = (d: number) => [pt({ t: 0 }), pt({ t: d * day })];
    expect(tickFormat(span(365))).toBe('month');
    expect(tickFormat(span(60))).toBe('day');
    expect(tickFormat([])).toBe('day');
  });
});

describe('timeExtent', () => {
  it('spans first to last, and never collapses to a zero-width axis', () => {
    expect(timeExtent([pt({ t: 10 }), pt({ t: 90 })])).toEqual([10, 90]);
    const [a, b] = timeExtent([pt({ t: 7 })]);
    expect(b).toBeGreaterThan(a);
    expect(timeExtent([])[1]).toBeGreaterThan(timeExtent([])[0]);
  });
});

describe('markKind', () => {
  it('reads a video the model would not stand behind as insufficient', () => {
    expect(markKind(pt({ weak: true, score: 4 }))).toBe('insufficient');
    expect(markKind(pt({ weak: false, score: null }))).toBe('insufficient');
  });
  it('calls twice the channel baseline an outlier, and the threshold is inclusive', () => {
    expect(markKind(pt({ score: 2 }))).toBe('outlier');
    expect(markKind(pt({ score: 6.2 }))).toBe('outlier');
    expect(markKind(pt({ score: 1.99 }))).toBe('normal');
    expect(markKind(pt({ score: 0.3 }))).toBe('normal');
  });
  it('draws the outlier tallest and the unbacked one shortest', () => {
    expect(MARK_HEIGHT.outlier).toBeGreaterThan(MARK_HEIGHT.normal);
    expect(MARK_HEIGHT.normal).toBeGreaterThan(MARK_HEIGHT.insufficient);
  });
});

describe('nearestByX', () => {
  const xs = [0, 40, 41, 200];
  it('gives back the tick under the pointer, within the hit width', () => {
    expect(nearestByX(xs, 199)).toBe(3);
    expect(nearestByX(xs, 3)).toBe(0);
  });
  it('picks one of a merged pair rather than stacking them', () => {
    expect(nearestByX(xs, 40.4)).toBe(1);
    expect(nearestByX(xs, 41)).toBe(2);
  });
  it('is nothing when the pointer is off every tick', () => {
    expect(nearestByX(xs, 120)).toBeNull();
    expect(nearestByX([], 10)).toBeNull();
  });
  it('hits from at least 6px away', () => {
    expect(nearestByX([100], 106)).toBe(0);
    expect(nearestByX([100], 107)).toBeNull();
  });
});
