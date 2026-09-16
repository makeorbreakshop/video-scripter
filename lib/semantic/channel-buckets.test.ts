import { channelBuckets } from './channel-buckets';

/** Rank samples measured on channels_identity_v1 (mean vector), 2026-09-14. */
const SAMPLES: Record<string, Array<[number, number]>> = {
  mobs: [[1, 0.895], [10, 0.890], [25, 0.880], [50, 0.846], [100, 0.798], [200, 0.756], [400, 0.716], [800, 0.673]],
  rober: [[1, 0.780], [10, 0.777], [25, 0.764], [50, 0.746], [100, 0.726], [200, 0.705], [400, 0.683], [800, 0.657]],
  veritasium: [[1, 0.810], [10, 0.803], [25, 0.775], [50, 0.755], [100, 0.718], [200, 0.691], [400, 0.662], [800, 0.628]],
};

/** Linear interpolation between the measured ranks, so a full 1..800 list can be synthesized. */
function synthesize(points: Array<[number, number]>): Array<{ channel_id: string; score: number }> {
  const out: Array<{ channel_id: string; score: number }> = [];
  for (let rank = 1; rank <= 800; rank += 1) {
    let lower = points[0];
    let upper = points[points.length - 1];
    for (let i = 0; i < points.length - 1; i += 1) {
      if (rank >= points[i][0] && rank <= points[i + 1][0]) { lower = points[i]; upper = points[i + 1]; break; }
    }
    const span = upper[0] - lower[0];
    const t = span === 0 ? 0 : (rank - lower[0]) / span;
    out.push({ channel_id: `c${rank}`, score: lower[1] + t * (upper[1] - lower[1]) });
  }
  return out;
}

describe('channelBuckets', () => {
  it('ignores a single near-duplicate top neighbor when deriving the spread', () => {
    const list = synthesize(SAMPLES.rober);
    const withDuplicate = [{ channel_id: 'dupe', score: 0.92 }, ...list];
    expect(channelBuckets(withDuplicate).thresholds.near_min)
      .toBeCloseTo(channelBuckets(list).thresholds.near_min, 2);
  });

  it('reproduces the eyeballed Make or Break Shop boundaries', () => {
    const { thresholds, near, adjacent } = channelBuckets(synthesize(SAMPLES.mobs));
    expect(thresholds.near_min).toBeCloseTo(0.820, 2);
    expect(thresholds.adjacent_min).toBeCloseTo(0.725, 2);
    expect(near.length).toBeGreaterThanOrEqual(50);
    expect(near.length).toBeLessThanOrEqual(85);
    expect(adjacent[adjacent.length - 1].score).toBeGreaterThanOrEqual(0.72);
  });

  it('gives Mark Rober and Veritasium non-empty near sets despite much lower absolute scores', () => {
    for (const key of ['rober', 'veritasium'] as const) {
      const { thresholds, near } = channelBuckets(synthesize(SAMPLES[key]));
      expect(thresholds.near_min).toBeLessThan(0.78);
      expect(near.length).toBeGreaterThanOrEqual(30);
      expect(near.length).toBeLessThanOrEqual(90);
      // A global 0.82 cutoff would have produced nothing at all for these channels.
      expect(near.every((n) => n.score < 0.82)).toBe(true);
    }
  });

  it('partitions the list exactly once', () => {
    const list = synthesize(SAMPLES.mobs);
    const { near, adjacent, far } = channelBuckets(list);
    expect(near.length + adjacent.length + far.length).toBe(list.length);
    const ids = new Set([...near, ...adjacent, ...far].map((n) => n.channel_id));
    expect(ids.size).toBe(list.length);
  });

  it('keeps a minimum near set when the list is flat or short', () => {
    const flat = Array.from({ length: 30 }, (_, i) => ({ channel_id: `f${i}`, score: 0.5 - i * 0.0001 }));
    const { near } = channelBuckets(flat);
    expect(near.length).toBeGreaterThanOrEqual(10);
  });

  it('handles an empty neighbor list', () => {
    const result = channelBuckets([]);
    expect(result.near).toEqual([]);
    expect(result.thresholds.near_min).toBe(0);
  });

  it('sorts input defensively and anchors on the deepest available rank', () => {
    const list = [{ channel_id: 'b', score: 0.5 }, { channel_id: 'a', score: 0.9 }];
    const { thresholds, near } = channelBuckets(list);
    expect(thresholds.top).toBe(0.9);
    expect(thresholds.top_rank).toBe(1);
    expect(thresholds.anchor_rank).toBe(2);
    expect(near[0].channel_id).toBe('a');
  });
});
