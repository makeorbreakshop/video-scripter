import { thumbnailVariants, testState, type ThumbRow } from './packaging';

// Real shape from thumbnail_versions: the watcher only diffs against the previous row, so a
// Test & Compare rotation that flips back produces a *new version* with the *same bytes*.
const row = (version: number, sha: string, first_seen: string, phash: string | null = null): ThumbRow =>
  ({ version, sha256: sha, phash, first_seen });

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 3, h, m)).toISOString();

describe('thumbnailVariants', () => {
  it('collapses a rotation back to an earlier image into the same variant', () => {
    // Steve Mould k3Q9UWWiPsQ on 2026-09-03: v2 RAM PUMP, v3 FAKE/REAL, v4 == v2 bytes.
    const rows = [row(2, 'ram', T(12)), row(3, 'fake', T(13, 40)), row(4, 'ram', T(15, 21))];
    const { variants, states } = thumbnailVariants(rows);
    expect(variants.map((v) => v.label)).toEqual(['A', 'B']);
    expect(variants[0].versions).toEqual([2, 4]);
    expect(variants[1].versions).toEqual([3]);
    expect(states.map((s) => s.variant)).toEqual(['A', 'B', 'A']);
    expect(states.map((s) => s.isReturn)).toEqual([false, false, true]);
  });

  it('treats the same picture with different bytes as one variant when phashes match', () => {
    const rows = [row(1, 'x1', T(10), 'aaaa'), row(2, 'y', T(11), 'ffff'), row(3, 'x2', T(12), 'aaab')];
    const { variants } = thumbnailVariants(rows);
    expect(variants).toHaveLength(2);
    expect(variants[0].versions).toEqual([1, 3]);
  });

  it('keeps genuinely new images as new variants, in first-seen order', () => {
    const rows = [row(1, 'a', T(9)), row(2, 'b', T(10)), row(3, 'c', T(11))];
    const { variants } = thumbnailVariants(rows);
    expect(variants.map((v) => v.label)).toEqual(['A', 'B', 'C']);
  });

  it('labels the current variant', () => {
    const rows = [row(1, 'a', T(9)), row(2, 'b', T(10)), row(3, 'a', T(11))];
    const { variants } = thumbnailVariants(rows);
    expect(variants.find((v) => v.current)?.label).toBe('A');
  });

  it('handles an empty history', () => {
    expect(thumbnailVariants([])).toEqual({ variants: [], states: [] });
  });
});

describe('testState', () => {
  const now = T(16);
  it('is none for a single image', () => {
    expect(testState([row(1, 'a', T(9))], now).status).toBe('none');
  });
  it('is a single swap when a new image replaces the old one without returning', () => {
    const s = testState([row(1, 'a', T(9)), row(2, 'b', T(10))], now);
    expect(s.status).toBe('swap');
  });
  it('is testing while images are still rotating', () => {
    // Chef Jean-Pierre O74Yv6m9ozc: A/B/A/B/A/B over ~100 minutes, last flip 1h before now.
    const rows = [row(1, 'a', T(13, 2)), row(2, 'b', T(13, 59)), row(3, 'a', T(14, 7)),
                  row(4, 'b', T(14, 21)), row(5, 'a', T(14, 30)), row(6, 'b', T(14, 45))];
    const s = testState(rows, now);
    expect(s.status).toBe('testing');
    expect(s.rotations).toBe(5);
    expect(s.variantCount).toBe(2);
    expect(s.startedAt).toBe(T(13, 59));
    expect(s.winner).toBeNull();
  });
  it('settles once one image has held for 48 hours, and names it the winner', () => {
    const rows = [row(1, 'a', T(9)), row(2, 'b', T(10)), row(3, 'a', T(11)), row(4, 'b', T(12))];
    const later = new Date(Date.UTC(2026, 8, 6, 12)).toISOString();
    const s = testState(rows, later);
    expect(s.status).toBe('settled');
    expect(s.winner).toBe('B');
    expect(s.settledAt).toBe(new Date(Date.UTC(2026, 8, 5, 12)).toISOString());
  });
  it('is not settled at 47 hours', () => {
    const rows = [row(1, 'a', T(9)), row(2, 'b', T(10)), row(3, 'a', T(11)), row(4, 'b', T(12))];
    const s = testState(rows, new Date(Date.UTC(2026, 8, 5, 11)).toISOString());
    expect(s.status).toBe('testing');
  });
});
