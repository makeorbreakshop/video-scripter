// Where the packaging groups land on the plot at the reader's current zoom.
//
// The groups themselves are lib/app/packaging-groups.ts — the same call the strip below the
// chart makes. This module is the only thing between those groups and the SVG: which are
// visible, which are so close together that drawing both would be two chips on top of each
// other, and where a chip can sit without hanging off the plate.
//
// It takes the zoom domain because the answer depends on it. Two rotations an hour apart are
// one smudge in a 365-day view and two separate windows once the reader drags into that
// afternoon — the collapsing is a function of the VISIBLE span, not of the calendar.
//
// Pure, so every one of those decisions is asserted in lib/app/chart-marks.test.ts rather than
// squinted at in a screenshot.
import type { PackagingMark } from './packaging-groups';

/** Closer together than this share of the visible span and two marks draw as one. */
export const COLLAPSE_FRACTION = 0.04;
/** A chip is written this far inside the plot's edge, so its text never runs off. */
export const CHIP_PAD_FRACTION = 0.015;
/** Past this share of the width the chip's text is written back to the left instead. */
const FLIP_AT = 0.75;

export type LaidOutMark = {
  key: string;
  kind: 'test' | 'swap' | 'title' | 'cluster';
  /** Left edge, clipped to the viewport. */
  startDay: number;
  /** Right edge of a shaded window, clipped; null for a rule. */
  endDay: number | null;
  /** True when the viewport cut the window short — the shading runs to the edge and stops. */
  clipped: boolean;
  chip: string;
  chipX: number;
  chipAnchor: 'start' | 'end';
  /** How many groups this mark stands for. 1 unless it is a cluster. */
  count: number;
  /** The packaging-group keys behind it — what a click hands the strip to expand. */
  groupKeys: string[];
  markerKeys: string[];
};

export function markerLayout(marks: PackagingMark[], domain: [number, number]): LaidOutMark[] {
  const [d0, d1] = domain;
  const span = d1 - d0;
  if (!(span > 0) || !marks.length) return [];
  const near = span * COLLAPSE_FRACTION;
  const pad = span * CHIP_PAD_FRACTION;

  // Visible, and clipped to what the reader can actually see.
  const visible = marks
    .map((m) => ({ m, end: m.endDay ?? m.startDay }))
    .filter(({ m, end }) => end >= d0 && m.startDay <= d1)
    .sort((a, b) => a.m.startDay - b.m.startDay)
    .map(({ m, end }) => {
      const start = Math.max(m.startDay, d0);
      const stop = Math.min(end, d1);
      return { m, start, stop, clipped: m.startDay < d0 || end > d1 };
    });

  // Anything whose chips would sit on top of each other becomes one chip that says how many.
  type Bucket = typeof visible;
  const buckets: Bucket[] = [];
  for (const v of visible) {
    const last = buckets[buckets.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && v.start - prev.stop < near) last.push(v);
    else buckets.push([v]);
  }

  return buckets.map((b) => {
    const start = Math.min(...b.map((v) => v.start));
    const stop = Math.max(...b.map((v) => v.stop));
    const markerKeys = b.flatMap((v) => v.m.markerKeys);
    const groupKeys = b.map((v) => v.m.key);
    const chipX = Math.min(Math.max(start, d0 + pad), d1 - pad);
    const chipAnchor: 'start' | 'end' = chipX > d0 + span * FLIP_AT ? 'end' : 'start';
    if (b.length === 1) {
      const { m, clipped } = b[0];
      return {
        key: m.key, kind: m.kind, startDay: start,
        endDay: m.endDay == null ? null : stop,
        clipped, chip: m.chip, chipX, chipAnchor, count: 1, groupKeys, markerKeys,
      };
    }
    // "N tests" only when they all are; a mixed cluster is N changes, which is what we saw.
    const allTests = b.every((v) => v.m.kind === 'test');
    return {
      key: `cluster-${b[0].m.key}`, kind: 'cluster' as const, startDay: start,
      endDay: stop > start ? stop : null,
      clipped: b.some((v) => v.clipped),
      chip: `${b.length} ${allTests ? 'tests' : 'changes'}`,
      chipX, chipAnchor, count: b.length, groupKeys, markerKeys,
    };
  });
}

/** How near a rule a click counts as a click ON it, as a share of the visible span. */
export const CLICK_TOLERANCE = 0.01;

/**
 * The mark the reader just clicked, if any.
 *
 * recharts gives a click on the plot as an x value, not as "you hit this ReferenceArea", so
 * the hit test is ours — which is just as well, because it means the click on a test window
 * works the same whether the reader lands on the shading, the chip or the line inside it.
 * Returns null for a click on empty plot, which must not close what the reader has open.
 */
export function markAt(laid: LaidOutMark[], day: number, domain: [number, number]): LaidOutMark | null {
  if (!Number.isFinite(day)) return null;
  const tol = (domain[1] - domain[0]) * CLICK_TOLERANCE;
  const hits = laid.filter((m) =>
    m.endDay != null ? day >= m.startDay - tol && day <= m.endDay + tol : Math.abs(day - m.startDay) <= tol
  );
  if (!hits.length) return null;
  // The narrowest one: a rule inside a window is the more specific thing to have clicked.
  return hits.sort((a, b) => ((a.endDay ?? a.startDay) - a.startDay) - ((b.endDay ?? b.startDay) - b.startDay))[0];
}
