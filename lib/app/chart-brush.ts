// The timeline handle under the chart — the thing a proper chart has and this one did not.
//
// Brandon, on the v4 chart: "click and drag and you highlight crap, this isn't a good
// interaction… give us a handle on the timeline like a nice proper chart would." The drag-to-
// zoom on the plot is gone. What replaces it is the control Google Finance, TradingView and
// Observable all settled on: a slim mini-map of the whole series under the x-axis, with a
// window on it you can widen, narrow, or slide.
//
// Every geometric decision that control makes lives here, as a pure function of pixels, days
// and the full domain — so "the handles cannot cross", "the window cannot leave the chart" and
// "the smallest window is the smallest chip" are asserted rather than felt. The component
// upstairs owns pointer capture and nothing else.

import { rangeChips } from './chart-zoom';

/** The track's height. Slim enough to read as a control, tall enough to show the shape. */
export const BRUSH_HEIGHT = 36;

/**
 * How far either side of a handle still counts as that handle. A 1px line is not a target;
 * twelve pixels is the smallest hit area a pointer finds without aiming, and it is what makes
 * the handles usable on a phone.
 */
export const HANDLE_HIT = 12;

/** The visible width of a handle's grip. The hit area is HANDLE_HIT; this is the ink. */
export const HANDLE_WIDTH = 7;

/**
 * Where the plot's drawing area sits inside its container: the YAxis' 52px plus the chart's own
 * 4px left margin, and the 58px right margin the end labels are written into. The brush is a
 * different SVG from the plot, so unless it is inset by exactly this the window under "Sep 4"
 * would not be over "Sep 4". Exported so the two cannot drift apart.
 */
export const PLOT_INSET = { left: 56, right: 58 } as const;

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return hi < lo ? lo : v < lo ? lo : v > hi ? hi : v;
}

// ------------------------------------------------------------ px <-> days ----

/** A day, as a distance from the track's left edge. Outside the domain reads off the track. */
export function dayToPx(day: number, full: [number, number], width: number): number {
  const span = full[1] - full[0];
  if (!(span > 0) || !(width > 0) || !Number.isFinite(day)) return 0;
  return ((day - full[0]) / span) * width;
}

/** The day under a pointer. Not clamped: the caller decides what off-track means. */
export function pxToDay(px: number, full: [number, number], width: number): number {
  const span = full[1] - full[0];
  if (!(span > 0) || !(width > 0) || !Number.isFinite(px)) return full[0];
  return full[0] + (px / width) * span;
}

/** The window as a rectangle on the track: where it starts and how wide it is. */
export function windowRect(
  view: [number, number],
  full: [number, number],
  width: number
): { x: number; w: number } {
  const x0 = clamp(dayToPx(view[0], full, width), 0, width);
  const x1 = clamp(dayToPx(view[1], full, width), 0, width);
  return { x: Math.min(x0, x1), w: Math.abs(x1 - x0) };
}

// ------------------------------------------------------- the window's rules ----

/**
 * The narrowest window the brush will make, and it is the shortest span the chips offer — so
 * the control and the chips agree about what "as close in as this chart goes" means. On a
 * chart too short to have any chip but "all", the whole domain is the minimum: there is
 * nothing to zoom into.
 */
export function minWindow(full: [number, number]): number {
  const span = full[1] - full[0];
  if (!(span > 0)) return 0;
  const named = rangeChips(full).filter((c) => c.days != null).map((c) => c.days as number);
  return Math.min(named.length ? Math.min(...named) : span, span);
}

/**
 * A window, made legal: in order, inside the chart, and never narrower than minWindow. Used on
 * every state the brush can produce, so no other function has to remember the invariants.
 */
export function clampWindow(win: [number, number], full: [number, number]): [number, number] {
  const span = full[1] - full[0];
  if (!(span > 0)) return [full[0], full[1]];
  const min = minWindow(full);
  let lo = Math.min(win[0], win[1]);
  let hi = Math.max(win[0], win[1]);
  if (!Number.isFinite(lo)) lo = full[0];
  if (!Number.isFinite(hi)) hi = full[1];
  lo = clamp(lo, full[0], full[1]);
  hi = clamp(hi, full[0], full[1]);
  if (hi - lo < min) {
    // Grow toward the right first, then left — whichever side has room.
    hi = lo + min;
    if (hi > full[1]) { hi = full[1]; lo = Math.max(full[0], hi - min); }
  }
  return [lo, hi];
}

export type Edge = 'start' | 'end';

/**
 * One handle, dragged to a pixel. The other edge does not move; the dragged one stops a
 * minWindow short of it rather than crossing it, which is why pulling the left handle all the
 * way to the right edge leaves the narrowest legal window instead of an inverted one.
 */
export function dragEdge(
  edge: Edge,
  px: number,
  view: [number, number],
  full: [number, number],
  width: number
): [number, number] {
  const day = pxToDay(px, full, width);
  const min = minWindow(full);
  return edge === 'start'
    ? clampWindow([clamp(day, full[0], view[1] - min), view[1]], full)
    : clampWindow([view[0], clamp(day, view[0] + min, full[1])], full);
}

/**
 * The window slid sideways by a pixel distance, keeping its width. It stops at either end of
 * the chart instead of shrinking against it — a pan that narrows the window is a pan the
 * reader did not ask for.
 */
export function panWindow(
  dxPx: number,
  view: [number, number],
  full: [number, number],
  width: number
): [number, number] {
  const span = view[1] - view[0];
  const dxDays = pxToDay(dxPx, [0, full[1] - full[0]], width);
  const lo = clamp(view[0] + dxDays, full[0], Math.max(full[0], full[1] - span));
  return clampWindow([lo, lo + span], full);
}

/**
 * An arrow key on a focused handle. A twentieth of the current window per press, so the nudge
 * stays proportional to how far in the reader is — one press is a visible step at every zoom.
 */
export function nudgeEdge(
  edge: Edge,
  dir: -1 | 1,
  view: [number, number],
  full: [number, number],
  width: number
): [number, number] {
  const step = Math.max((view[1] - view[0]) / 20, 1 / 1440);
  const day = (edge === 'start' ? view[0] : view[1]) + dir * step;
  return dragEdge(edge, dayToPx(day, full, width), view, full, width);
}

/** What is under the pointer on the track: an edge to resize, the window to pan, or nothing. */
export function partAt(
  px: number,
  view: [number, number],
  full: [number, number],
  width: number,
  hit = HANDLE_HIT
): Edge | 'window' | null {
  if (!(width > 0)) return null;
  const { x, w } = windowRect(view, full, width);
  if (Math.abs(px - x) <= hit) return 'start';
  if (Math.abs(px - (x + w)) <= hit) return 'end';
  if (px > x && px < x + w) return 'window';
  return null;
}

// ------------------------------------------------------------- the mini-map ----

export interface BrushPoint { day: number; views: number; kind?: string }

/**
 * The series drawn on the track: a polyline through every point, scaled to the whole domain and
 * to the track's own height. Returned as an SVG `d` so a node test can read the geometry
 * without a browser. Empty string when there is nothing to draw.
 */
export function brushPath(
  points: BrushPoint[],
  full: [number, number],
  width: number,
  height: number,
  /** The value at the top of the track. Shared between paths so two lines share one scale. */
  top?: number,
  pad = 3
): string {
  const usable = points.filter((p) => Number.isFinite(p.day) && Number.isFinite(p.views));
  if (usable.length < 2 || !(width > 0) || !(height > pad * 2)) return '';
  const hi = Math.max(top ?? 0, ...usable.map((p) => p.views), 1);
  const y = (v: number) => height - pad - (Math.max(v, 0) / hi) * (height - pad * 2);
  return usable
    .map((p, i) => `${i ? 'L' : 'M'}${dayToPx(p.day, full, width).toFixed(2)} ${y(p.views).toFixed(2)}`)
    .join(' ');
}

/**
 * The two paths the track draws: what happened (solid) and what is expected (dashed), on ONE
 * scale — computed here rather than per path, because two lines of the same series drawn to
 * two maxima is a mini-map that disagrees with itself at the join. The dashed path starts at
 * the last point of the solid one so they meet.
 */
export function brushPaths(
  points: BrushPoint[],
  full: [number, number],
  width: number,
  height: number
): { solid: string; dashed: string } {
  const top = Math.max(1, ...points.filter((p) => Number.isFinite(p.views)).map((p) => p.views));
  const past = points.filter((p) => p.kind !== 'forecast');
  const ahead = points.filter((p) => p.kind === 'forecast');
  const joined = past.length && ahead.length ? [past[past.length - 1], ...ahead] : ahead;
  return {
    solid: brushPath(past, full, width, height, top),
    dashed: brushPath(joined, full, width, height, top),
  };
}
