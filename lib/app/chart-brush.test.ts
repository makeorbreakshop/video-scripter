// The brush is the chart's only viewport control now, so every rule it enforces — the handles
// cannot cross, the window cannot leave the chart, the smallest window is the smallest chip —
// is asserted here rather than discovered by a reader who dragged too far.
import {
  BRUSH_HEIGHT, HANDLE_HIT, PLOT_INSET, dayToPx, pxToDay, windowRect, minWindow, clampWindow,
  dragEdge, panWindow, nudgeEdge, partAt, brushPath, brushPaths,
} from './chart-brush';
import { rangeChips, chipViewport, activeChip } from './chart-zoom';

const FULL: [number, number] = [0, 30];
const W = 600;

describe('the control has a real hit area and a real height', () => {
  it('is slim, and its handles are wider than a line', () => {
    expect(BRUSH_HEIGHT).toBeGreaterThanOrEqual(28);
    expect(BRUSH_HEIGHT).toBeLessThanOrEqual(44);
    expect(HANDLE_HIT).toBeGreaterThanOrEqual(12);
  });

  it('is inset exactly as far as the plot it sits under', () => {
    // 52px of y axis + the chart's 4px left margin; 58px of right margin. If these drift the
    // window stops being over the day it names.
    expect(PLOT_INSET).toEqual({ left: 56, right: 58 });
  });
});

describe('px <-> day', () => {
  it('maps the ends of the domain to the ends of the track', () => {
    expect(dayToPx(0, FULL, W)).toBe(0);
    expect(dayToPx(30, FULL, W)).toBe(W);
    expect(pxToDay(0, FULL, W)).toBe(0);
    expect(pxToDay(W, FULL, W)).toBe(30);
  });

  it('round-trips', () => {
    for (const d of [0.25, 3, 17.4, 29.9]) expect(pxToDay(dayToPx(d, FULL, W), FULL, W)).toBeCloseTo(d, 6);
  });

  it('survives a track with no width and a domain with no span', () => {
    expect(dayToPx(5, FULL, 0)).toBe(0);
    expect(pxToDay(5, [4, 4], W)).toBe(4);
    expect(dayToPx(5, [4, 4], W)).toBe(0);
  });

  it('draws the window where the days are', () => {
    expect(windowRect([0, 15], FULL, W)).toEqual({ x: 0, w: 300 });
    expect(windowRect([15, 30], FULL, W)).toEqual({ x: 300, w: 300 });
  });

  it('never draws a window off the end of the track', () => {
    const r = windowRect([-10, 90], FULL, W);
    expect(r.x).toBe(0);
    expect(r.w).toBe(W);
  });
});

describe('minWindow is the smallest chip the chart offers', () => {
  it('is six hours on a month', () => {
    expect(minWindow(FULL)).toBeCloseTo(6 / 24, 9);
    expect(minWindow([0, 365])).toBeCloseTo(6 / 24, 9);
  });

  it('is the whole chart when the chart is shorter than any chip', () => {
    // A six-hour video offers only "all", so there is nothing to zoom into.
    expect(minWindow([0, 6 / 24])).toBeCloseTo(6 / 24, 9);
    expect(minWindow([0, 0.05])).toBeCloseTo(0.05, 9);
  });

  it('is nothing at all for an empty domain', () => {
    expect(minWindow([4, 4])).toBe(0);
  });
});

describe('clampWindow: the invariants, in one place', () => {
  it('puts a backwards window back in order', () => {
    expect(clampWindow([20, 4], FULL)).toEqual([4, 20]);
  });

  it('pulls a window that ran off the chart back onto it', () => {
    expect(clampWindow([-40, 900], FULL)).toEqual([0, 30]);
  });

  it('widens a window narrower than the smallest chip', () => {
    const w = clampWindow([10, 10.01], FULL);
    expect(w[1] - w[0]).toBeCloseTo(minWindow(FULL), 9);
  });

  it('grows leftward when there is no room on the right', () => {
    const w = clampWindow([30, 30], FULL);
    expect(w[1]).toBe(30);
    expect(w[1] - w[0]).toBeCloseTo(minWindow(FULL), 9);
  });

  it('is the whole of a chart too tiny to zoom', () => {
    expect(clampWindow([0.01, 0.02], [0, 0.05])).toEqual([0, 0.05]);
  });
});

describe('dragEdge: one handle moves, the other stays', () => {
  it('drags the left handle in', () => {
    expect(dragEdge('start', W / 2, [0, 30], FULL, W)).toEqual([15, 30]);
  });

  it('drags the right handle in', () => {
    expect(dragEdge('end', W / 2, [0, 30], FULL, W)).toEqual([0, 15]);
  });

  it('will not let the handles cross', () => {
    // Pull the left handle past the right one: it stops a minWindow short.
    const w = dragEdge('start', W, [0, 10], FULL, W);
    expect(w[1]).toBe(10);
    expect(w[0]).toBeCloseTo(10 - minWindow(FULL), 9);
    const v = dragEdge('end', 0, [10, 20], FULL, W);
    expect(v[0]).toBe(10);
    expect(v[1]).toBeCloseTo(10 + minWindow(FULL), 9);
  });

  it('stops at the ends of the chart, however far the pointer went', () => {
    expect(dragEdge('start', -5000, [10, 20], FULL, W)).toEqual([0, 20]);
    expect(dragEdge('end', 5000, [10, 20], FULL, W)).toEqual([10, 30]);
  });

  it('never produces an illegal window on a tiny chart', () => {
    const tiny: [number, number] = [0, 0.05];
    for (const px of [-100, 0, 10, 599, 9000]) {
      for (const edge of ['start', 'end'] as const) {
        const w = dragEdge(edge, px, [0, 0.05], tiny, W);
        expect(w[0]).toBeGreaterThanOrEqual(tiny[0]);
        expect(w[1]).toBeLessThanOrEqual(tiny[1]);
        expect(w[1]).toBeGreaterThan(w[0] - 1e-9);
      }
    }
  });
});

describe('panWindow: the window slides, it does not resize', () => {
  it('keeps its width', () => {
    const w = panWindow(100, [5, 15], FULL, W);
    expect(w[1] - w[0]).toBeCloseTo(10, 9);
    expect(w[0]).toBeCloseTo(10, 9);
  });

  it('slides the other way too', () => {
    expect(panWindow(-100, [5, 15], FULL, W)[0]).toBeCloseTo(0, 9);
  });

  it('stops at the ends instead of shrinking against them', () => {
    const left = panWindow(-9000, [5, 15], FULL, W);
    expect(left).toEqual([0, 10]);
    const right = panWindow(9000, [5, 15], FULL, W);
    expect(right[1]).toBeCloseTo(30, 9);
    expect(right[1] - right[0]).toBeCloseTo(10, 9);
  });

  it('does nothing to a window that is already the whole chart', () => {
    expect(panWindow(200, [0, 30], FULL, W)).toEqual([0, 30]);
  });
});

describe('nudgeEdge: the keyboard reaches the same windows the pointer does', () => {
  it('moves the focused handle by a visible step', () => {
    const w = nudgeEdge('start', 1, [0, 20], FULL, W);
    expect(w[0]).toBeGreaterThan(0);
    expect(w[1]).toBe(20);
  });

  it('is proportional to the zoom, so one press is always visible', () => {
    const wide = nudgeEdge('end', 1, [0, 20], [0, 365], W)[1] - 20;
    const tight = nudgeEdge('end', 1, [0, 1], [0, 365], W)[1] - 1;
    expect(wide).toBeGreaterThan(tight);
  });

  it('stops at the ends and never crosses', () => {
    expect(nudgeEdge('start', -1, [0, 20], FULL, W)).toEqual([0, 20]);
    expect(nudgeEdge('end', 1, [0, 30], FULL, W)).toEqual([0, 30]);
    const w = nudgeEdge('start', 1, [0, minWindow(FULL)], FULL, W);
    expect(w[1] - w[0]).toBeCloseTo(minWindow(FULL), 9);
  });
});

describe('partAt: what the pointer is on', () => {
  const view: [number, number] = [10, 20];   // x 200..400 on a 600px track

  it('finds each handle within its hit area', () => {
    expect(partAt(200, view, FULL, W)).toBe('start');
    expect(partAt(200 - HANDLE_HIT + 1, view, FULL, W)).toBe('start');
    expect(partAt(400, view, FULL, W)).toBe('end');
    expect(partAt(400 + HANDLE_HIT - 1, view, FULL, W)).toBe('end');
  });

  it('finds the window between them', () => {
    expect(partAt(300, view, FULL, W)).toBe('window');
  });

  it('finds nothing outside', () => {
    expect(partAt(20, view, FULL, W)).toBeNull();
    expect(partAt(580, view, FULL, W)).toBeNull();
  });

  it('prefers the handle to the window where they overlap', () => {
    expect(partAt(205, view, FULL, W)).toBe('start');
  });
});

describe('the chips and the brush are the same control', () => {
  it('every chip asks for a window the brush would allow', () => {
    for (const full of [[0, 3], [0, 30], [0, 365], [0, 0.25]] as [number, number][]) {
      for (const c of rangeChips(full)) {
        const v = chipViewport(c, full);
        expect(clampWindow(v, full)).toEqual(v);
        expect(v[1] - v[0]).toBeGreaterThanOrEqual(minWindow(full) - 1e-9);
      }
    }
  });

  it('a brush dragged onto a chip lights that chip', () => {
    const c = rangeChips(FULL).find((x) => x.key === '7d')!;
    const target = chipViewport(c, FULL);
    const brushed = dragEdge('end', dayToPx(7, FULL, W), [0, 30], FULL, W);
    expect(brushed).toEqual(target);
    expect(activeChip(brushed, FULL)).toBe('7d');
  });

  it('a brush the reader pulled by hand lights nothing', () => {
    expect(activeChip(panWindow(100, [0, 7], FULL, W), FULL)).toBeNull();
  });
});

describe('brushPath: the shape, small', () => {
  const pts = [{ day: 0, views: 0 }, { day: 15, views: 500 }, { day: 30, views: 1000 }];

  it('runs the whole width of the track', () => {
    const d = brushPath(pts, FULL, W, BRUSH_HEIGHT);
    expect(d.startsWith('M0.00 ')).toBe(true);
    expect(d).toContain(`L${W.toFixed(2)} `);
  });

  it('puts the biggest value at the top and the smallest at the bottom', () => {
    const ys = brushPath(pts, FULL, W, BRUSH_HEIGHT).split(/[ML]/).filter(Boolean)
      .map((s) => Number(s.trim().split(' ')[1]));
    expect(ys[0]).toBeGreaterThan(ys[2]);
    expect(ys[2]).toBeGreaterThanOrEqual(0);
    expect(ys[0]).toBeLessThanOrEqual(BRUSH_HEIGHT);
  });

  it('has nothing to draw for one point, no points, or no room', () => {
    expect(brushPath([pts[0]], FULL, W, BRUSH_HEIGHT)).toBe('');
    expect(brushPath([], FULL, W, BRUSH_HEIGHT)).toBe('');
    expect(brushPath(pts, FULL, 0, BRUSH_HEIGHT)).toBe('');
    expect(brushPath(pts, FULL, W, 2)).toBe('');
  });

  it('ignores points that are not numbers', () => {
    const d = brushPath([...pts, { day: NaN, views: 5 }, { day: 2, views: NaN }], FULL, W, BRUSH_HEIGHT);
    expect(d.split('L').length).toBe(3);
  });
});

describe('brushPaths: two lines, one scale', () => {
  const pts = [
    { day: 0, views: 0, kind: 'implied' }, { day: 1, views: 100, kind: 'measured' },
    { day: 2, views: 200, kind: 'forecast' }, { day: 3, views: 1000, kind: 'forecast' },
  ];

  it('scales both paths to the same top, so they meet instead of stepping', () => {
    const { implied, dashed } = brushPaths(pts, [0, 3], W, BRUSH_HEIGHT);
    const lastSolid = implied.split('L').pop()!.trim();
    const firstDashed = dashed.slice(1).split('L')[0].trim();
    expect(firstDashed).toBe(lastSolid);
  });

  it('does not turn reconstructed history solid in the overview either', () => {
    const { solid, dashed, implied } = brushPaths(pts, [0, 3], W, BRUSH_HEIGHT);
    expect(solid).toBe(''); // only one actual observation; no measured segment exists
    expect(implied.split(/[ML]/).filter(Boolean).length).toBe(2);
    expect(dashed.split(/[ML]/).filter(Boolean).length).toBe(3);   // the join + two forecasts
  });

  it('has nothing to draw when there is nothing measured yet', () => {
    expect(brushPaths([], [0, 3], W, BRUSH_HEIGHT)).toEqual({ solid: '', dashed: '', implied: '' });
  });
});
