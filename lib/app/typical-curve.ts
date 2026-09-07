// The dashed "typical for this channel" line on the video page.
//
// It is channelCurve(priors, age) evaluated at every age on the chart's grid: the SAME function,
// on the SAME priors, that the score divides by. So at the video's own age the line passes
// through views / score exactly, and the reader can put a finger on the chart and read the
// headline multiple off it.
//
// It used to be `C(30) x exp(-mult(age))` -- the channel's day-30 anchor dragged along the
// GLOBAL growth shape (lib/admin/video-curve.expectedAtAge). That is a different curve: C(t) is
// a weighted median of the priors' own readings AT t, and no global shape reproduces it. On a
// sub-day video the two disagreed by 3.6x, and rather than draw a false line the page suppressed
// it for every v5 row, so the score had no picture at all.
//
// A grid age with no curve leaves a GAP. Null means "we cannot say what normal is here" -- for
// a channel whose priors have no reading anywhere near that age, most often the launch hours --
// and drawing it as zero would say the opposite.
import { q, one } from '../admin/db';
import { channelCurve, type CurvePrior } from '../scoring/curve';
import { loadCurvePriors } from '../scoring/prior-load';
import type { GlobalParams } from '../scoring/core';
import type { TypicalPoint } from '../admin/video-curve';
import { scoreParamsQuery } from './score-version';

/** channelCurve over a grid of ages. Pure — this is what the equality test pins. */
export function typicalCurveOver(
  priors: readonly CurvePrior[],
  days: readonly number[],
  params: GlobalParams
): TypicalPoint[] {
  return days.map((day) => {
    // Age 0 has no growth curve to stand on and no prior reading at it; the grid's own first
    // point is the publish instant, which is not an age the model speaks about.
    const typical = day > 0 ? channelCurve(priors, day, params).typical : null;
    return { day, expected: typical };
  });
}

/** The priors this video is scored against, straight from lib/scoring/prior-load. */
export async function loadTypicalPriors(videoId: string): Promise<CurvePrior[]> {
  const byVideo = await loadCurvePriors(q, [videoId]);
  return byVideo.get(videoId) ?? [];
}

/** The fitted global params the app reads (lib/app/score-version.ts). */
export async function loadCurveParams(): Promise<GlobalParams | null> {
  const row = await one<{ params: GlobalParams }>(...scoreParamsQuery('params'));
  return row?.params ?? null;
}

/**
 * The line, for one video, over one grid. Empty when there are no params or no priors — an
 * empty curve is how the chart says "no line", and it is what the page did for every v5 row
 * until now.
 */
export async function videoTypicalCurve(
  videoId: string,
  days: readonly number[],
  loadPriors: (id: string) => Promise<CurvePrior[]> = loadTypicalPriors
): Promise<TypicalPoint[]> {
  if (!days.length) return [];
  const [priors, params] = await Promise.all([loadPriors(videoId), loadCurveParams()]);
  if (!params || !priors.length) return [];
  const pts = typicalCurveOver(priors, days, params);
  return pts.some((p) => p.expected != null) ? pts : [];
}
