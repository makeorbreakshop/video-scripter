jest.mock('../admin/db', () => ({ q: jest.fn(), one: jest.fn() }));
import { q } from '../admin/db';
import {
  channelBaselineSeries, hasBaselineLine, viewsDomain, timeTicks, tickFormat, dotSize, MIN_BASELINE_POINTS,
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

  it('marks an unbacked score weak and drops its number, but keeps the dot', async () => {
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

describe('viewsDomain', () => {
  it('stays strictly positive so the log axis has a floor it can draw', () => {
    const [lo, hi] = viewsDomain([pt({ baseline: 1, est30: 2 })]);
    expect(lo).toBeGreaterThanOrEqual(1);
    expect(hi).toBeGreaterThan(lo);
    expect(viewsDomain([])[0]).toBeGreaterThanOrEqual(1);
  });
  it('covers both the line and the dots', () => {
    const [lo, hi] = viewsDomain([pt({ baseline: 1000, est30: 4_000_000 })]);
    expect(lo).toBeLessThan(1000);
    expect(hi).toBeGreaterThan(4_000_000);
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

describe('dotSize', () => {
  it('drops the ring before it drops the dot, as the cloud thickens', () => {
    expect(dotSize(15).ring).toBeGreaterThan(0);
    expect(dotSize(15).r).toBeGreaterThan(dotSize(800).r);
    expect(dotSize(800).ring).toBe(0);
  });
});
