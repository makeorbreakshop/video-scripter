// Curve / band / marker math for the admin video page. Pure functions, no I/O.
//
// The expected curve is the model's own view of a typical video on this channel:
// scoring (lib/scoring/core.ts) projects est30 = v_t * exp(m(day)), where m is the fitted
// global median of log(v30 / v_t) per day bucket (score_params.params.mult, m(30) = 0).
// Inverting that for a video whose day-30 views land exactly on the channel baseline gives
//     expected(day) = baseline * exp(-m(day))
// and the band is the model's own median absolute log error at that age: expected * exp(±ale).

export type Mult = Record<number, number>;
/** Fitted long tail past day 30: `mult[i]` is views at `ages[i]` as a multiple of day-30 views. */
export type Longtail = { ages: number[]; mult: number[] };
export type CurvePoint = { day: number; expected: number; lo: number; hi: number };
export type ProjPoint = { day: number; projected: number };
export type Actual = { day: number; views: number; source: 'snapshot' | 'sample'; at: string };
export type Marker = {
  kind: 'thumb' | 'title';
  day: number;
  at: string;
  version: number;
  fromVersion: number | null;
  from: string | null;
  to: string | null;
};

// Backtested median absolute log error of the v3 blend, by age in days.
export const ALE_BY_DAY: [number, number][] = [[1, 0.26], [3, 0.18], [7, 0.1], [14, 0.05]];

function interp(pts: [number, number][], day: number, extrapolateLow = false): number {
  if (!pts.length) return 0;
  const x = Math.log(Math.max(0, day) + 1);
  if (x <= Math.log(pts[0][0] + 1)) {
    // Below the first fitted bucket, carry the first segment's slope on rather than sitting flat:
    // a flat clamp would draw the launch hours as a straight line at expected(d1).
    if (!extrapolateLow || pts.length < 2) return pts[0][1];
    const [d0, v0] = pts[0], [d1, v1] = pts[1];
    const x0 = Math.log(d0 + 1), x1 = Math.log(d1 + 1);
    const m = v0 + ((v1 - v0) * (x - x0)) / (x1 - x0);
    return Math.max(m, pts[0][1]); // more growth left than at d1, never less
  }
  for (let i = 1; i < pts.length; i++) {
    const [d0, v0] = pts[i - 1], [d1, v1] = pts[i];
    const x0 = Math.log(d0 + 1), x1 = Math.log(d1 + 1);
    if (x <= x1) return v0 + ((v1 - v0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}

// Remaining log growth to day 30 at `day`, interpolated between the fitted buckets in log(day+1).
/**
 * Growth past day 30, as a multiple of day-30 views. The fit ends at day 30, so a video's life
 * after that is described by score_params.params.longtail: 1.0 at day 30 rising to ~1.3 by
 * year one. Interpolated in log(day) between the fitted ages; flat past the last one.
 */
export function longtailAt(lt: Longtail | null | undefined, day: number): number {
  if (day <= 30) return 1;
  const pts: [number, number][] = [[30, 1]];
  const ages = lt?.ages ?? [], mult = lt?.mult ?? [];
  for (let i = 0; i < ages.length; i++) {
    const a = Number(ages[i]), m = Number(mult[i]);
    if (Number.isFinite(a) && Number.isFinite(m) && a > 30 && m > 0) pts.push([a, m]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return 1;
  if (day >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  const x = Math.log(day);
  for (let i = 1; i < pts.length; i++) {
    const [d0, v0] = pts[i - 1], [d1, v1] = pts[i];
    if (day <= d1) {
      const x0 = Math.log(d0), x1 = Math.log(d1);
      return v0 + ((v1 - v0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

export function multAt(mult: Mult, day: number): number {
  const pts = Object.entries(mult)
    .map(([d, v]) => [Number(d), Number(v)] as [number, number])
    .filter(([d, v]) => Number.isFinite(d) && Number.isFinite(v))
    .sort((a, b) => a[0] - b[0]);
  if (!pts.length) return 0;
  if (day >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  return interp(pts, day, true);
}

export function aleAt(day: number): number {
  return interp(ALE_BY_DAY, day);
}

export function expectedAt(baseline: number, mult: Mult, day: number, lt?: Longtail | null): CurvePoint {
  const expected = day > 30
    ? baseline * longtailAt(lt, day)
    : baseline * Math.exp(-multAt(mult, day));
  const a = aleAt(day);
  return { day, expected, lo: expected * Math.exp(-a), hi: expected * Math.exp(a) };
}

// ~60 sample days, denser early (even in log(day+1)) so the launch window is readable.
// Both curves share these days so the chart can zip them into one row per day.
export function curveDays(maxDay: number, steps = 60, minDay = 0): number[] {
  const end = Math.max(minDay + 1e-9, maxDay);
  const lo = Math.log(Math.max(0, minDay) + 1);
  const hi = Math.log(end + 1);
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) out.push(Math.exp(lo + ((hi - lo) * i) / steps) - 1);
  out[0] = minDay;
  out[out.length - 1] = end;
  return out;
}

// What a video that ends up exactly on the channel baseline looks like along the way.
export function expectedCurve(baseline: number | null | undefined, mult: Mult, maxDay: number, steps = 60, minDay = 0, lt?: Longtail | null): CurvePoint[] {
  if (!baseline || baseline <= 0 || !Number.isFinite(baseline)) return [];
  return curveDays(maxDay, steps, minDay).map((d) => expectedAt(baseline, mult, d, lt));
}

// This video's own projection: the same shape, scaled so it lands on est30 at day 30.
export function projectedCurve(est30: number | null | undefined, mult: Mult, maxDay: number, steps = 60, minDay = 0, lt?: Longtail | null): ProjPoint[] {
  if (!est30 || est30 <= 0 || !Number.isFinite(est30)) return [];
  return curveDays(maxDay, steps, minDay).map((d) => ({
    day: d,
    projected: d > 30 ? est30 * longtailAt(lt, d) : est30 * Math.exp(-multAt(mult, d)),
  }));
}

/**
 * The forecast from where the video is NOW: starts at the latest measurement and lands on the
 * model's day-30 estimate, following the channel's typical shape for the growth still to come.
 * (The old scaled-curve projection did not pass through the current point, so the drawn line
 * jumped away from the measured one, and its end label disagreed with the headline est30.)
 *   f(d) = share of the typical remaining growth that has happened by day d
 *   views(d) = viewsNow * (est30 / viewsNow) ^ f(d)         for dayNow <= d <= 30
 *   views(d) = est30 * longtail(d)                           for d > 30
 */
export function forecastCurve(viewsNow: number, dayNow: number, est30: number | null | undefined, mult: Mult, maxDay: number, steps = 60, lt?: Longtail | null): ProjPoint[] {
  if (!(viewsNow > 0) || !est30 || est30 <= 0 || !Number.isFinite(est30) || !(dayNow >= 0)) return [];
  if (dayNow >= 30) {
    const base = viewsNow / longtailAt(lt, dayNow);
    return curveDays(maxDay, steps, dayNow).map((d) => ({ day: d, projected: base * longtailAt(lt, Math.max(d, dayNow)) }));
  }
  const gNow = multAt(mult, Math.max(dayNow, 0.04)); // log growth still to come at dayNow
  const ratio = est30 / viewsNow;
  return curveDays(maxDay, steps, dayNow).map((d) => {
    if (d <= dayNow) return { day: d, projected: viewsNow };
    if (d >= 30) return { day: d, projected: est30 * longtailAt(lt, d) };
    const f = gNow > 0 ? 1 - multAt(mult, d) / gNow : 1;
    return { day: d, projected: viewsNow * Math.pow(ratio, Math.min(Math.max(f, 0), 1)) };
  });
}

type Point = { at: string | Date; views: number };

// Daily snapshots + 15-minute launch samples on one days-since-publish axis. Snapshot wins on a tie.
export function mergeActuals(publishedAt: string | Date, snapshots: Point[], samples: Point[]): Actual[] {
  const t0 = new Date(publishedAt).getTime();
  const byDay = new Map<number, Actual>();
  const add = (p: Point, source: Actual['source']) => {
    const at = new Date(p.at);
    const day = (at.getTime() - t0) / 86400000;
    const views = Number(p.views);
    if (!Number.isFinite(day) || day < 0 || !(views > 0)) return;
    if (source === 'sample' && byDay.has(day)) return;
    byDay.set(day, { day, views, source, at: at.toISOString() });
  };
  for (const p of samples) add(p, 'sample');
  for (const p of snapshots) add(p, 'snapshot');
  const sorted = [...byDay.values()].sort((a, b) => a.day - b.day);
  // Collapse noise: a snapshot within 12h of a real sample adds nothing, and a repeated
  // identical count (a catalog re-read of an unchanged number) is not a second measurement.
  const kept: Actual[] = [];
  for (const a of sorted) {
    if (a.source === 'snapshot' && sorted.some((b) => b.source === 'sample' && Math.abs(b.day - a.day) < 0.5)) continue;
    const last = kept[kept.length - 1];
    if (last && last.views === a.views && a.day - last.day < 2) continue;
    kept.push(a);
  }
  return kept;
}

/**
 * Fit the channel's typical curve to this video's measurements: the median ratio of measured
 * views to typical views at the same age. The implied path is typical × that scale, so it passes
 * through the points instead of only being pinned to the day-30 estimate.
 */
export function fitScale(actuals: { day: number; views: number }[], baseline: number | null | undefined, mult: Mult, lt?: Longtail | null): number | null {
  if (baseline == null || !(baseline > 0)) return null;
  const ratios = actuals
    .filter((a) => a.day > 0.04 && a.views > 0)
    .map((a) => a.views / expectedAt(baseline, mult, a.day, lt).expected)
    .filter((r) => Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b);
  if (!ratios.length) return null;
  const mid = Math.floor(ratios.length / 2);
  return ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
}

type ThumbVer = { version: number; first_seen: string | Date };
type TitleVer = { version: number; title: string; first_seen: string | Date };

// One marker per packaging change after the original: thumbnail v2+ and title v2+.
export function packagingMarkers(publishedAt: string | Date, thumbs: ThumbVer[], titles: TitleVer[]): Marker[] {
  const t0 = new Date(publishedAt).getTime();
  const day = (at: string | Date) => (new Date(at).getTime() - t0) / 86400000;
  const out: Marker[] = [];
  const tv = [...thumbs].sort((a, b) => a.version - b.version);
  for (let i = 0; i < tv.length; i++) {
    if (tv[i].version <= 1) continue;
    const d = day(tv[i].first_seen);
    if (!Number.isFinite(d) || d < 0) continue;
    out.push({ kind: 'thumb', day: d, at: new Date(tv[i].first_seen).toISOString(), version: tv[i].version, fromVersion: tv[i - 1]?.version ?? tv[i].version - 1, from: null, to: null });
  }
  const tt = [...titles].sort((a, b) => a.version - b.version);
  for (let i = 0; i < tt.length; i++) {
    if (tt[i].version <= 1) continue;
    const d = day(tt[i].first_seen);
    if (!Number.isFinite(d) || d < 0) continue;
    out.push({ kind: 'title', day: d, at: new Date(tt[i].first_seen).toISOString(), version: tt[i].version, fromVersion: tt[i - 1]?.version ?? tt[i].version - 1, from: tt[i - 1]?.title ?? null, to: tt[i].title });
  }
  return out.sort((a, b) => a.day - b.day);
}

/**
 * What a typical video on this channel would have at `ageDays`: the fitted growth curve up to
 * day 30, then the fitted long tail. This is the denominator of the "right now" pace, and it
 * keeps rising past day 30 instead of sitting flat at the baseline.
 */
export function expectedAtAge(baseline: number | null | undefined, mult: Mult, ageDays: number, lt?: Longtail | null): number | null {
  if (baseline == null || !(baseline > 0)) return null;
  if (ageDays > 30) return baseline * longtailAt(lt, ageDays);
  return baseline * Math.exp(-multAt(mult, Math.max(ageDays, 0.04)));
}
