// What the chart actually draws for the packaging groups at the current zoom: which windows are
// visible, which collapse into one chip, and where the chip sits so it stays on the plate.
import { markerLayout, markAt, COLLAPSE_FRACTION } from './chart-marks';
import type { PackagingMark } from './packaging-groups';

const test = (key: string, startDay: number, endDay: number): PackagingMark =>
  ({ key, kind: 'test', startDay, endDay, chip: 'A/B', markerKeys: [key], variants: [] });
const swap = (key: string, startDay: number): PackagingMark =>
  ({ key, kind: 'swap', startDay, endDay: null, chip: 'swap', markerKeys: [key], variants: [] });

describe('markerLayout: what is visible in this zoom', () => {
  it('drops marks entirely outside the viewport', () => {
    const out = markerLayout([test('a', 0.5, 0.6), test('b', 20, 21)], [0, 3]);
    expect(out.map((m) => m.key)).toEqual(['a']);
  });

  it('keeps a window that only overlaps the viewport, clipped to it', () => {
    const [m] = markerLayout([test('a', 2.5, 8)], [0, 3]);
    expect(m.startDay).toBeCloseTo(2.5, 6);
    expect(m.endDay).toBe(3);
    expect(m.clipped).toBe(true);
  });

  it('leaves a window inside the viewport alone', () => {
    const [m] = markerLayout([test('a', 1, 2)], [0, 3]);
    expect(m.clipped).toBe(false);
    expect(m.endDay).toBe(2);
  });
});

describe('markerLayout: overlapping windows collapse, and open again on zoom-in', () => {
  const marks = [test('a', 10.0, 10.2), test('b', 10.3, 10.5), test('c', 200, 201)];

  it('collapses neighbours that would draw on top of each other in the full view', () => {
    const out = markerLayout(marks, [0, 365]);
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe('cluster');
    expect(out[0].count).toBe(2);
    expect(out[0].chip).toBe('2 tests');
    expect(out[0].markerKeys).toEqual(['a', 'b']);
    expect(out[1].key).toBe('c');
  });

  it('separates them again once the reader zooms into the day they happened', () => {
    const out = markerLayout(marks, [9.5, 11]);
    expect(out.map((m) => m.key)).toEqual(['a', 'b']);
    expect(out.every((m) => m.kind === 'test')).toBe(true);
  });

  it('says "changes" when the collapsed group is not all tests', () => {
    const out = markerLayout([test('a', 10, 10.2), swap('b', 10.3)], [0, 365]);
    expect(out[0].chip).toBe('2 changes');
  });

  it('collapses on a fraction of the VISIBLE span, so the rule scales with the zoom', () => {
    // Two marks a hair further apart than the fraction allows stay separate.
    const gap = COLLAPSE_FRACTION * 100 * 1.5;
    expect(markerLayout([swap('a', 10), swap('b', 10 + gap)], [0, 100])).toHaveLength(2);
    expect(markerLayout([swap('a', 10), swap('b', 10 + gap)], [0, 1000])).toHaveLength(1);
  });
});

describe('markerLayout: the chip stays on the plot', () => {
  it('clamps a chip at the left edge inward', () => {
    const [m] = markerLayout([swap('a', 0)], [0, 30]);
    expect(m.chipX).toBeGreaterThan(0);
    expect(m.chipAnchor).toBe('start');
  });

  it('flips a chip near the right edge back into the plot', () => {
    const [m] = markerLayout([swap('a', 29.9)], [0, 30]);
    expect(m.chipX).toBeLessThanOrEqual(30);
    expect(m.chipAnchor).toBe('end');
  });

  it('puts a window’s chip at the start of its visible part', () => {
    const [m] = markerLayout([test('a', 2.5, 8)], [3, 10]);
    expect(m.startDay).toBe(3);
    expect(m.chipX).toBeGreaterThanOrEqual(3);
  });

  it('has nothing to lay out when there are no marks', () => {
    expect(markerLayout([], [0, 30])).toEqual([]);
  });
});

describe('a mark carries the group keys a click hands to the strip', () => {
  it('names the one group it stands for', () => {
    expect(markerLayout([test('test', 1, 2)], [0, 30])[0].groupKeys).toEqual(['test']);
  });

  it('names every group inside a cluster', () => {
    const out = markerLayout([test('a', 10, 10.2), swap('b', 10.3)], [0, 365]);
    expect(out[0].groupKeys).toEqual(['a', 'b']);
  });
});

describe('markAt: which mark the reader clicked', () => {
  const laid = markerLayout([test('test', 1, 2), swap('s', 8)], [0, 30]);

  it('finds the window a click landed inside', () => {
    expect(markAt(laid, 1.5, [0, 30])!.key).toBe('test');
  });

  it('finds a rule the click landed on', () => {
    expect(markAt(laid, 8.05, [0, 30])!.key).toBe('s');
  });

  it('is null on empty plot, so a stray click closes nothing', () => {
    expect(markAt(laid, 20, [0, 30])).toBeNull();
    expect(markAt(laid, NaN, [0, 30])).toBeNull();
  });
});
