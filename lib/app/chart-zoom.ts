// The only way to change what the chart shows: drag across it, double-click to come back.
//
// The page used to carry "First 72h / Since publish" chips, which made the reader pick a frame
// before they could read anything and left the two frames drawing subtly different series. One
// continuous view now; the zoom is a viewport over the SAME series, so nothing about the data
// changes when the reader looks closer.
//
// Pure so the drag rules — order, clamping, and what counts as a click rather than a drag —
// are asserted rather than felt.

/**
 * Shorter than this and it was a click, not a drag. Half an hour: enough that a deliberate
 * pull across the launch hour still zooms, small enough that a stray click does nothing.
 */
export const MIN_ZOOM_SPAN = 30 / 1440;

/**
 * The viewport a drag from `a` to `b` asks for, clamped to the full domain, or null when the
 * gesture was not a zoom (a click, a drag that never started, a number that is not one). Null
 * means "keep what you have" — never "reset", which is what double-click is for.
 */
export function zoomDomain(
  a: number | null | undefined,
  b: number | null | undefined,
  full: [number, number]
): [number, number] | null {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const lo = Math.max(Math.min(a as number, b as number), full[0]);
  const hi = Math.min(Math.max(a as number, b as number), full[1]);
  if (!(hi - lo >= MIN_ZOOM_SPAN)) return null;
  return [lo, hi];
}

/** Whether the reader is looking at all of it — the state a double-click returns to. */
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

// ------------------------------------------------ the zoom, made visible ----
//
// The drag was the only way to change the view and nothing on the plate said so. A reader who
// never tried it saw one fixed frame; a reader who tried it and overshot had no way back except
// a double-click nobody had told them about. So: a hint while the view is whole, a rectangle
// under the cursor while the drag is happening, a reset chip while it is not whole — and, for
// the spans a creator actually asks for ("the first day", "the first week"), chips that set the
// viewport without any dragging at all.

/** Said once, in the plot's top-right corner, and gone the moment the reader has zoomed. */
export const ZOOM_HINT = 'drag to zoom · double-click to reset';

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
