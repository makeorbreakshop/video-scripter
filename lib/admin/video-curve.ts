// Curve / band / marker math for the admin video page. Pure functions, no I/O.
//
// The expected curve is the model's own view of a typical video on this channel:
// scoring (lib/scoring/core.ts) projects est30 = v_t * exp(m(day)), where m is the fitted
// global median of log(v30 / v_t) per day bucket (score_params.params.mult, m(30) = 0).
// Inverting that for a video whose day-30 views land exactly on the channel baseline gives
//     expected(day) = baseline * exp(-m(day))
// and the band is the model's own median absolute log error at that age: expected * exp(±ale).

export type Mult = Record<number, number>;
export type CurvePoint = { day: number; expected: number; lo: number; hi: number };
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

function interp(pts: [number, number][], day: number): number {
  if (!pts.length) return 0;
  const x = Math.log(Math.max(0, day) + 1);
  if (x <= Math.log(pts[0][0] + 1)) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [d0, v0] = pts[i - 1], [d1, v1] = pts[i];
    const x0 = Math.log(d0 + 1), x1 = Math.log(d1 + 1);
    if (x <= x1) return v0 + ((v1 - v0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}

// Remaining log growth to day 30 at `day`, interpolated between the fitted buckets in log(day+1).
export function multAt(mult: Mult, day: number): number {
  const pts = Object.entries(mult)
    .map(([d, v]) => [Number(d), Number(v)] as [number, number])
    .filter(([d, v]) => Number.isFinite(d) && Number.isFinite(v))
    .sort((a, b) => a[0] - b[0]);
  if (!pts.length) return 0;
  if (day >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  return interp(pts, day);
}

export function aleAt(day: number): number {
  return interp(ALE_BY_DAY, day);
}

export function expectedAt(baseline: number, mult: Mult, day: number): CurvePoint {
  const expected = baseline * Math.exp(-multAt(mult, day));
  const a = aleAt(day);
  return { day, expected, lo: expected * Math.exp(-a), hi: expected * Math.exp(a) };
}

// ~60 points, denser early (even in log(day+1)) so the launch window is readable.
export function expectedCurve(baseline: number | null | undefined, mult: Mult, maxDay: number, steps = 60): CurvePoint[] {
  if (!baseline || baseline <= 0 || !Number.isFinite(baseline)) return [];
  const hi = Math.log(Math.max(1, maxDay) + 1);
  const out: CurvePoint[] = [];
  for (let i = 0; i <= steps; i++) out.push(expectedAt(baseline, mult, Math.exp((hi * i) / steps) - 1));
  out[0] = expectedAt(baseline, mult, 0);
  out[out.length - 1] = expectedAt(baseline, mult, Math.max(1, maxDay));
  return out;
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
  return [...byDay.values()].sort((a, b) => a.day - b.day);
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
