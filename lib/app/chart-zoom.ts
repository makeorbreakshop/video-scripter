// What part of the chart the reader is looking at.
//
// v5, 2026-09-04. The viewport used to be set by dragging ACROSS THE PLOT — which, as Brandon
// put it, "you highlight crap, this isn't a good interaction": a gesture with no affordance, no
// handle to adjust afterwards, and a text selection as its side effect. The gesture is gone.
// The viewport is now set by a brush track under the x-axis (lib/app/chart-brush.ts) and by the
// chips, which are the same control said in words. What is left in this file is what a viewport
// MEANS: the ticks it implies, the chips it offers, and which chip it is.
//
// The zoom is still a viewport over the SAME series either way — nothing is recomputed,
// refetched or re-fitted when the reader looks closer.

/** Whether the reader is looking at all of it — the state a double-click on the track returns to. */
export function isFullDomain(view: [number, number], full: [number, number]): boolean {
  return view[0] <= full[0] && view[1] >= full[1];
}

/**
 * The x-axis ticks for a viewport. With one continuous view the axis has to read sensibly at
 * every scale a drag can produce — six hours, six days, a year — so the step is chosen from
 * spans a reader thinks in, and the ticks are multiples of it. (The old chart had two fixed
 * tick lists, one per range button, which is what the range buttons were really for.)
 */
export const TICK_STEPS = [1 / 24, 2 / 24, 3 / 24, 6 / 24, 12 / 24, 1, 2, 3, 7, 14, 30, 60, 90, 180, 365];

export function axisTicks(domain: [number, number], max = 7): number[] {
  const [d0, d1] = domain;
  if (!(d1 > d0)) return [];
  const step = TICK_STEPS.find((s) => (d1 - d0) / s <= max) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const out: number[] = [];
  for (let k = Math.ceil(d0 / step - 1e-9); k * step <= d1 + 1e-9; k++) out.push(Number((k * step).toFixed(6)));
  return out;
}

// ------------------------------------------------------------------ chips ----
//
// The spans a creator asks for by name. They are the brush track's window, preset — picking one
// sets the same viewport a drag on the track would, and a drag on the track lights none of them.

export interface RangeChip {
  key: string;
  /** The span from publish the chip asks for. Null is the whole domain. */
  days: number | null;
}

/** The spans a creator thinks in. `all` is last because it is where the chart starts. */
export const RANGE_CHIPS: readonly RangeChip[] = [
  { key: '6h', days: 6 / 24 },
  { key: '24h', days: 1 },
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: 'all', days: null },
];

const EPS = 1e-6;

/**
 * The chips worth offering for a domain. A chip longer than the chart is a chip that does
 * nothing — "30d" on a six-hour video is "all" wearing a different word — so it is not drawn.
 * A chip exactly as long as the domain is the same button as `all`, and goes for the same reason.
 */
export function rangeChips(full: [number, number]): RangeChip[] {
  const span = full[1] - full[0];
  if (!(span > 0)) return [];
  return RANGE_CHIPS.filter((c) => c.days == null || c.days < span - EPS);
}

/** The viewport a chip asks for: from publish, that far, never past the end of the chart. */
export function chipViewport(chip: RangeChip, full: [number, number]): [number, number] {
  if (chip.days == null) return [full[0], full[1]];
  return [full[0], Math.min(full[0] + chip.days, full[1])];
}

/**
 * Which chip the current viewport IS, or null when it is a viewport the reader dragged. That
 * null is the point: a drag deselects the chips, because a highlighted "24h" over a window the
 * reader pulled by hand would be the chart lying about what it is showing.
 */
export function activeChip(view: [number, number], full: [number, number]): string | null {
  for (const c of rangeChips(full)) {
    const v = chipViewport(c, full);
    if (Math.abs(v[0] - view[0]) < EPS && Math.abs(v[1] - view[1]) < EPS) return c.key;
  }
  return null;
}
