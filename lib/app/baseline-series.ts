// The pure half of the Analytics tab: the point type and the geometry decisions the chart
// makes about it. Its own module because components/app/channel-baseline-plot.tsx is a client
// component — importing these from channel-analytics.ts would drag lib/admin/db.ts, and so the
// `pg` driver, into the browser bundle. Only types and pure functions cross this boundary.

/** One video: where the channel's normal sat when it went out, and where it landed. */
export type BaselinePoint = {
  videoId: string;
  title: string;
  /** Publish time in ms — the chart's x axis is a real time axis, not an index. */
  t: number;
  publishedAt: string;
  /** The channel's typical day-30 views as of this publish date. Null before there is one. */
  baseline: number | null;
  /** This video's day-30 estimate. */
  est30: number | null;
  score: number | null;
  /** True when the model could not stand behind the score — the tick is drawn faintest. */
  weak: boolean;
  /** The video's thumbnail for the hover card. YouTube's current image, which is always live. */
  thumbUrl: string | null;
  /** The archived copy, shown only if the CDN url 404s (components/app/thumb-runtime.ts). */
  thumbFallbackUrl: string | null;
};


/** A dozen points is a shape; two is a rumour. Below this the tab shows its empty state. */
export const MIN_BASELINE_POINTS = 3;


/**
 * Does this channel have enough of a line to draw? Counted on the BASELINE, not on the rows:
 * a channel we have scored but never had a baseline for would otherwise render an axis with
 * nothing on it.
 */
export function hasBaselineLine(points: BaselinePoint[]): boolean {
  return points.filter((p) => p.baseline != null).length >= MIN_BASELINE_POINTS;
}

/**
 * The y domain, in views. It covers the BASELINE and nothing else — the value axis carries one
 * series now, so letting a single 5M video widen the domain would push the line the chart is
 * about into a flat band at the bottom. A log axis is still the right one: a channel's normal
 * can move by an order of magnitude across a decade, and a log axis cannot draw zero or a
 * negative, so the floor is clamped to 1 and every value is already filtered to > 0 by `num`.
 * Padded by a factor rather than a constant, because on a log scale that is what headroom is.
 */
export function baselineDomain(points: BaselinePoint[]): [number, number] {
  const vals = points.map((p) => p.baseline).filter((v): v is number => v != null);
  if (!vals.length) return [1, 10];
  const lo = Math.max(1, Math.min(...vals) / 1.6);
  const hi = Math.max(...vals) * 1.6;
  return [lo, hi];
}

/** Month ticks across the range, at most `max` of them, so the axis never crowds. */
export function timeTicks(points: BaselinePoint[], max = 6): number[] {
  if (points.length < 2) return points.map((p) => p.t);
  const first = points[0].t, last = points[points.length - 1].t;
  if (!(last > first)) return [first];
  const step = (last - first) / (max - 1);
  return Array.from({ length: max }, (_, i) => Math.round(first + i * step));
}

/**
 * How the x ticks read. A channel that uploads twice a month and one that uploads twenty times
 * a week share this chart, and "Aug 26 / Aug 26 / Aug 26" — six ticks all naming the same month
 * — is what a month-and-year format does to the second one. Over a season the day matters; over
 * a year it does not and the year does.
 */
export type TickFormat = 'month' | 'day';
const A_SEASON = 150 * 86_400_000;
export function tickFormat(points: BaselinePoint[]): TickFormat {
  if (points.length < 2) return 'day';
  return points[points.length - 1].t - points[0].t > A_SEASON ? 'month' : 'day';
}

/** The first and last publish time on the plot — the time axis the video band shares. */
export function timeExtent(points: BaselinePoint[]): [number, number] {
  if (!points.length) return [0, 1];
  const first = points[0].t, last = points[points.length - 1].t;
  return last > first ? [first, last] : [first, first + 1];
}

/**
 * What a video is drawn as on the time axis. Three kinds, one channel of ink each: a video the
 * model would not stand behind is the faintest, a video that cleared twice its channel's
 * baseline is the accent one, everything else is the plain tick.
 */
export type MarkKind = 'insufficient' | 'outlier' | 'normal';

/** Twice the channel's normal. The same threshold the score badge reads as an outlier. */
export const OUTLIER_SCORE = 2;

export function markKind(p: BaselinePoint): MarkKind {
  if (p.weak || p.score == null) return 'insufficient';
  return p.score >= OUTLIER_SCORE ? 'outlier' : 'normal';
}

/** Tick height in px per kind. Nothing here encodes views — only which of the three it is. */
export const MARK_HEIGHT: Record<MarkKind, number> = { insufficient: 5, normal: 7, outlier: 11 };

/** The band the ticks live in, just above the x axis. */
export const BAND_HEIGHT = 14;

/** How far from a tick the pointer still counts as on it. A tick is 1px; a finger is not. */
export const HIT_PX = 6;

/**
 * Which tick the pointer is on. Ticks merge on a daily channel and that is fine — they are not
 * stacked, so at a shared x the reader gets the nearest one and the rest are the same day.
 * `xs` is ascending; ties go to the earlier video.
 */
export function nearestByX(xs: number[], x: number, maxDist = HIT_PX): number | null {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i] - x);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best >= 0 && bestD <= maxDist ? best : null;
}

/**
 * The hover card's width, and the thumbnail inside it: the same 120px plate the video chart's
 * packaging-marker card uses, plus the card's own padding and border.
 */
export const CARD_THUMB = 120;
export const CARD_W = CARD_THUMB + 24;

/**
 * Where the hover card's left edge goes, in the plot's own pixels.
 *
 * Two rules, both from the same complaint: the card sat ON the tick it was describing, and it
 * ran off the right edge of the chart. So it is placed BESIDE the tick — right of it by
 * default, left of it when the right side has no room — and then clamped into [0, plotW - w]
 * so it can never leave the plot on either edge. When the plot is narrower than the card the
 * clamp wins and returns 0; a card half off-screen is worse than one that overlaps.
 */
export function cardLeft(x: number, plotW: number, cardW = CARD_W, gap = 12): number {
  const max = Math.max(0, plotW - cardW);
  const right = x + gap;
  const left = x - gap - cardW;
  const pick = right + cardW <= plotW ? right : left >= 0 ? left : right;
  return Math.min(Math.max(pick, 0), max);
}
