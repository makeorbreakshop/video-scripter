// Reading a packaging change as an experiment.
//
// A thumbnail or title swap is the only lever a creator pulls mid-flight, so the honest
// question is narrow: did views arrive faster after the swap than before it? We answer it
// from the 15-minute launch samples (view_samples) — the daily snapshots are far too coarse
// to see a same-day swap — by comparing views-per-hour in a short window on each side.
//
// Two deliberate limits, because this is observational and not a real A/B test:
//   * a window never crosses a neighbouring change, so two swaps an hour apart do not share data;
//   * a side with fewer than MIN_SAMPLES points is reported as "too early" rather than guessed at.
// Natural decay also means a flat ratio is normal: views-per-hour falls on its own, so
// "no clear effect" is the honest read for anything inside the ±15% band.
//
// Pure functions, no I/O. Curve/marker math stays in lib/admin/video-curve.ts.
import type { Marker } from '../admin/video-curve';

export const HOUR = 3_600_000;
/** Longest half-window we will look at on either side of a change. */
export const WINDOW_HOURS = 6;
/** Points needed on a side before we are willing to call the result anything. */
export const MIN_SAMPLES = 4;
export const HELPED_AT = 1.15;
export const HURT_AT = 0.85;

export type Sample = { at: string | Date; views: number | string };
export type Verdict = 'helped' | 'hurt' | 'no clear effect' | 'too early';

export type Window = { vph: number | null; n: number; hours: number };

export type Experiment = {
  kind: Marker['kind'];
  version: number;
  fromVersion: number | null;
  /** Title text either side of the change (thumbnail changes carry nulls here). */
  from: string | null;
  to: string | null;
  at: string;
  day: number;
  beforeVph: number | null;
  afterVph: number | null;
  beforeSamples: number;
  afterSamples: number;
  windowBeforeHours: number;
  windowAfterHours: number;
  ratio: number | null;
  verdict: Verdict;
};

/**
 * Views per hour between the first and last sample inside [from, to] (both inclusive).
 * view_count is cumulative, so the rate is the delta over the elapsed hours; a count that
 * was revised down clamps to 0 rather than reporting negative growth.
 */
export function vphIn(samples: Sample[], from: number, to: number): Window {
  const inWindow = samples
    .map((s) => ({ t: new Date(s.at).getTime(), v: Number(s.views) }))
    .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.v) && s.t >= from && s.t <= to)
    .sort((a, b) => a.t - b.t);
  const hours = Math.max(0, (to - from) / HOUR);
  if (inWindow.length < 2) return { vph: null, n: inWindow.length, hours };
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  const span = (last.t - first.t) / HOUR;
  if (span <= 0) return { vph: null, n: inWindow.length, hours };
  return { vph: Math.max(0, (last.v - first.v) / span), n: inWindow.length, hours };
}

export function verdictFor(before: Window, after: Window): { ratio: number | null; verdict: Verdict } {
  if (before.vph == null || after.vph == null || before.n < MIN_SAMPLES || after.n < MIN_SAMPLES) {
    return { ratio: before.vph != null && after.vph != null && before.vph > 0 ? after.vph / before.vph : null, verdict: 'too early' };
  }
  if (before.vph <= 0) return { ratio: null, verdict: 'too early' };
  const ratio = after.vph / before.vph;
  if (ratio >= HELPED_AT) return { ratio, verdict: 'helped' };
  if (ratio <= HURT_AT) return { ratio, verdict: 'hurt' };
  return { ratio, verdict: 'no clear effect' };
}

/**
 * One experiment per packaging change, in chronological order. `markers` comes from
 * packagingMarkers() so thumbnail and title changes bound each other's windows.
 */
export function experiments(
  publishedAt: string | Date,
  samples: Sample[],
  markers: Marker[],
  now: number = Date.now()
): Experiment[] {
  const t0 = new Date(publishedAt).getTime();
  if (!Number.isFinite(t0) || !markers.length) return [];
  const sorted = [...markers].sort((a, b) => a.day - b.day);
  const times = sorted.map((m) => new Date(m.at).getTime());

  return sorted.map((m, i) => {
    const at = times[i];
    const prev = i > 0 ? times[i - 1] : t0;
    const next = i < times.length - 1 ? times[i + 1] : now;
    const back = Math.min(WINDOW_HOURS * HOUR, Math.max(0, at - prev));
    const fwd = Math.min(WINDOW_HOURS * HOUR, Math.max(0, next - at));
    const before = vphIn(samples, at - back, at);
    const after = vphIn(samples, at, at + fwd);
    const { ratio, verdict } = verdictFor(before, after);
    return {
      kind: m.kind,
      version: m.version,
      fromVersion: m.fromVersion,
      from: m.from,
      to: m.to,
      at: m.at,
      day: m.day,
      beforeVph: before.vph,
      afterVph: after.vph,
      beforeSamples: before.n,
      afterSamples: after.n,
      windowBeforeHours: back / HOUR,
      windowAfterHours: fwd / HOUR,
      ratio,
      verdict,
    };
  });
}
