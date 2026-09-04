// One continuous view: no range buttons. The reader drags across the part they care about and
// double-clicks to come back. Both are decisions about a domain, so both are testable here.
import { zoomDomain, MIN_ZOOM_SPAN } from './chart-zoom';

const FULL: [number, number] = [0, 30];

describe('zoomDomain: a drag becomes a viewport', () => {
  it('turns a left-to-right drag into that range', () => {
    expect(zoomDomain(4, 9, FULL)).toEqual([4, 9]);
  });

  it('reads a right-to-left drag the same way', () => {
    expect(zoomDomain(9, 4, FULL)).toEqual([4, 9]);
  });

  it('clamps a drag that ran off the plot back to the data', () => {
    expect(zoomDomain(-3, 900, FULL)).toEqual([0, 30]);
  });

  it('ignores a click — a drag of nothing is not a zoom', () => {
    expect(zoomDomain(5, 5, FULL)).toBeNull();
    expect(zoomDomain(5, 5 + MIN_ZOOM_SPAN / 2, FULL)).toBeNull();
  });

  it('ignores a drag that never started, or ran off into nonsense', () => {
    expect(zoomDomain(null, 9, FULL)).toBeNull();
    expect(zoomDomain(4, null, FULL)).toBeNull();
    expect(zoomDomain(NaN, 9, FULL)).toBeNull();
  });

  it('keeps the launch readable: a half-hour drag is still a zoom', () => {
    const z = zoomDomain(0, MIN_ZOOM_SPAN * 1.5, [0, 3])!;
    expect(z[1] - z[0]).toBeGreaterThan(0);
  });
});

import { axisTicks } from './chart-zoom';

describe('axisTicks: one axis that reads at every scale a drag can reach', () => {
  it('reads in hours when the reader is inside the launch', () => {
    const t = axisTicks([0, 0.25]);
    expect(t[0]).toBe(0);
    expect(t.length).toBeGreaterThan(2);
    expect(t[t.length - 1]).toBeLessThanOrEqual(0.25);
  });

  it('reads in days across the first month', () => {
    expect(axisTicks([0, 30])).toEqual([0, 7, 14, 21, 28]);
  });

  it('reads in months across a year', () => {
    expect(axisTicks([0, 365])).toEqual([0, 60, 120, 180, 240, 300, 360]);
  });

  it('starts inside the viewport, never before it', () => {
    for (const d of [[3, 10], [12.4, 19.1], [100, 365]] as [number, number][]) {
      const t = axisTicks(d);
      expect(t[0]).toBeGreaterThanOrEqual(d[0]);
      expect(t[t.length - 1]).toBeLessThanOrEqual(d[1]);
    }
  });

  it('never crowds the axis', () => {
    for (const d of [[0, 0.1], [0, 3], [0, 47], [2, 900]] as [number, number][]) {
      expect(axisTicks(d).length).toBeLessThanOrEqual(8);
    }
  });

  it('has nothing to draw for an empty domain', () => {
    expect(axisTicks([5, 5])).toEqual([]);
  });
});

// A six-hour horizon is a real domain now (lib/app/chart-horizon.ts), not just something a
// drag can produce, so the axis has to read in hours without the reader doing anything.
describe('axisTicks on the sub-day domains the horizon itself can produce', () => {
  it('puts an hourly tick across a six-hour chart', () => {
    const t = axisTicks([0, 6 / 24]);
    expect(t.length).toBeGreaterThanOrEqual(4);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeCloseTo(6 / 24, 6);
    for (const x of t) expect(x).toBeLessThanOrEqual(6 / 24 + 1e-9);
    // every tick is a whole number of hours
    for (const x of t) expect(Math.abs(x * 24 - Math.round(x * 24))).toBeLessThan(1e-3); // ticks are rounded to 6dp
  });

  it('steps in hours, never in days, under a day', () => {
    for (const end of [6 / 24, 12 / 24, 1]) {
      const t = axisTicks([0, end]);
      expect(t.length).toBeGreaterThanOrEqual(3);
      expect(t[1] - t[0]).toBeLessThanOrEqual(1 / 4 + 1e-9);
    }
  });

  it('never returns more ticks than the axis has room for', () => {
    for (const end of [6 / 24, 12 / 24, 1, 3, 30, 365]) expect(axisTicks([0, end]).length).toBeLessThanOrEqual(8);
  });
});

// ------------------------------------------------ the zoom, made visible ----
//
// Brandon, on Matt Wolfe's GPT-6 video: the chart could be zoomed and nothing said so. The
// affordances are decisions about a domain like every other one here, so they are asserted here.
import { ZOOM_HINT, RANGE_CHIPS, rangeChips, chipViewport, activeChip } from './chart-zoom';

const keys = (full: [number, number]) => rangeChips(full).map((c) => c.key);

describe('the range chips offer only spans shorter than the chart', () => {
  it('offers a six-hour video nothing but the whole of it', () => {
    expect(keys([0, 6 / 24])).toEqual(['all']);
  });

  it('offers a three-day video its first six hours and its first day', () => {
    expect(keys([0, 3])).toEqual(['6h', '24h', 'all']);
  });

  it('drops the chip that is the same button as "all"', () => {
    // A 30d chip on a 30-day chart sets the domain it already has.
    expect(keys([0, 30])).toEqual(['6h', '24h', '7d', 'all']);
  });

  it('offers the whole ladder on a year', () => {
    expect(keys([0, 365])).toEqual(['6h', '24h', '7d', '30d', 'all']);
  });

  it('has nothing to offer for an empty domain', () => {
    expect(rangeChips([0, 0])).toEqual([]);
  });

  it('always ends on "all"', () => {
    expect(RANGE_CHIPS[RANGE_CHIPS.length - 1].days).toBeNull();
  });
});

describe('a chip is a viewport from publish, clamped to the chart', () => {
  it('runs from publish to the span it names', () => {
    expect(chipViewport({ key: '24h', days: 1 }, [0, 30])).toEqual([0, 1]);
    expect(chipViewport({ key: '7d', days: 7 }, [0, 30])).toEqual([0, 7]);
  });

  it('never runs past the end of the chart', () => {
    expect(chipViewport({ key: '30d', days: 30 }, [0, 3])).toEqual([0, 3]);
  });

  it('is the whole domain for "all"', () => {
    expect(chipViewport({ key: 'all', days: null }, [0, 3])).toEqual([0, 3]);
  });
});

describe('activeChip: which chip the reader is looking at', () => {
  const FULL30: [number, number] = [0, 30];

  it('is "all" at rest', () => {
    expect(activeChip(FULL30, FULL30)).toBe('all');
  });

  it('is the chip whose viewport this is', () => {
    expect(activeChip([0, 1], FULL30)).toBe('24h');
    expect(activeChip([0, 7], FULL30)).toBe('7d');
    expect(activeChip([0, 6 / 24], FULL30)).toBe('6h');
  });

  it('is nothing at all after a drag', () => {
    // A drag deselects: a lit "24h" over a hand-pulled window would be the chart lying.
    expect(activeChip([2, 9], FULL30)).toBeNull();
    expect(activeChip([0, 4], FULL30)).toBeNull();
  });

  it('never names a chip the chart is not offering', () => {
    expect(activeChip([0, 3], [0, 3])).toBe('all');   // not "30d", clamped though it would be
  });
});

describe('the hint says both gestures, once', () => {
  it('names the drag and the way back', () => {
    expect(ZOOM_HINT).toBe('drag to zoom · double-click to reset');
  });
});
