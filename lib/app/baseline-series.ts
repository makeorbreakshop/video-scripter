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
  /** True when the model could not stand behind the score — the dot is drawn faded. */
  weak: boolean;
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
 * The y domain, in views. A log axis is the right one here — a channel's dots span three or
 * four orders of magnitude and a single 5M video would otherwise flatten the baseline line
 * into the axis — and a log axis cannot show zero or a negative, so the floor is clamped to 1
 * and every value on the plot is already filtered to > 0 by `num` above. Padded by a factor
 * rather than by a constant, because on a log scale that is what "a bit of headroom" means.
 */
export function viewsDomain(points: BaselinePoint[]): [number, number] {
  const vals: number[] = [];
  for (const p of points) {
    if (p.baseline != null) vals.push(p.baseline);
    if (p.est30 != null) vals.push(p.est30);
  }
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

/**
 * A news channel puts 700 dots on this plot and a maker channel puts 15. At 700 the 4px dot
 * with its surface ring is a white haze; the ring is what has to go first, because at that
 * density it is separating dots from each other that the reader is not reading individually
 * anyway — the cloud's SHAPE against the line is the reading.
 */
export function dotSize(count: number): { r: number; ring: number } {
  if (count > 400) return { r: 2, ring: 0 };
  if (count > 150) return { r: 3, ring: 0 };
  return { r: 4, ring: 1.5 };
}
