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
