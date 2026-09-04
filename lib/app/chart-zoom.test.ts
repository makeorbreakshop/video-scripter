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
