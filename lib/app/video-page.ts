// Everything the user-facing video page renders, assembled in one place.
//
// The reads and the curve math are NOT reimplemented here: lib/admin/queries.ts videoPage()
// is the single query for a video's series and packaging history, and lib/admin/video-curve.ts
// is the single source of truth for the expected/projected curves and the change markers.
// This module only composes them, adds the thumbnail URLs and the experiment read, and hands
// the result to the page as plain serialisable data.
import { videoPage as adminVideoPage, type VideoPageData } from '../admin/queries';
import {
  mergeActuals, expectedCurve, projectedCurve, packagingMarkers,
  type Actual, type CurvePoint, type ProjPoint, type Marker,
  expectedAtAge,
} from '../admin/video-curve';
import { thumbUrl } from '../thumbs/storage';
import { experiments, type Experiment } from './experiment';

export type ThumbVersionView = { version: number; first_seen: string; url: string };
export type TitleVersionView = { version: number; title: string; first_seen: string };

export type VideoPageView = {
  ageDays: number;
  pace: number | null; // views now ÷ what a typical video on the channel has at this age
  /** What a typical video on this channel has by now — the denominator of `pace`. */
  expectedNow: number | null;
  /** Last day drawn: today for a video past the last forecast milestone, else the next milestone. */
  horizonDay: number;
  /** Too few real points to read a shape, so the implied path is drawn across the whole range. */
  sparse: boolean;
  /** 'now' for a video past day 30 (pace leads), 'day30' for a young one (the projection leads). */
  headline: 'now' | 'day30';
  id: string;
  title: string;
  channelId: string;
  channelName: string;
  publishedAt: string;
  views: number;
  thumbUrl: string | null;
  thumbFallbackUrl: string | null;
  score: VideoPageData['score'];
  actuals: Actual[];
  curve: CurvePoint[];
  projected: ProjPoint[];
  markers: Marker[];
  experiments: Experiment[];
  thumbs: ThumbVersionView[];
  titles: TitleVersionView[];
  thumbUrls: Record<number, string>;
  defaultZoom: '72h' | 'full';
  lastSeen: string | null;
  counts: { snapshots: number; samples: number };
};

/** R2 first (public, immutable, zero-egress); the archive route is the signed-in fallback. */
export function versionThumbUrl(videoId: string, version: number): string {
  return thumbUrl(videoId, version) ?? `/api/admin/thumb/${videoId}/${version}`;
}

/**
 * The big thumbnail at the top of the page. R2 is preferred (immutable, zero egress) but
 * only holds a version once the watcher uploaded it; a version that never reached R2
 * 404s, which used to leave the plate blank. YouTube's own image is always current.
 */
export function heroThumb(
  videoId: string,
  thumbs: { version: number; r2_uploaded_at: string | null }[],
  youtubeUrl: string | null,
): { src: string; fallback: string | null } {
  const yt = youtubeUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const sorted = [...thumbs].sort((a, b) => a.version - b.version);
  const latest = sorted[sorted.length - 1];
  const uploaded = [...sorted].reverse().find((t) => t.r2_uploaded_at);
  if (latest && uploaded && latest.version === uploaded.version) {
    return { src: versionThumbUrl(videoId, latest.version), fallback: yt };
  }
  return { src: yt, fallback: uploaded ? versionThumbUrl(videoId, uploaded.version) : null };
}

export function archiveFallbackUrl(videoId: string, version: number): string {
  return `/api/admin/thumb/${videoId}/${version}`;
}

export async function loadVideoPage(id: string, now: number = Date.now()): Promise<VideoPageView | null> {
  const { video: v, snapshots, samples, thumbs, titles, score, mult, longtail } = await adminVideoPage(id);
  if (!v) return null;

  const actuals = mergeActuals(v.published_at, snapshots, samples);
  const markers = packagingMarkers(v.published_at, thumbs, titles);
  const ageDays = (now - new Date(v.published_at).getTime()) / 86_400_000;
  // Draw the whole life, then a little forecast past today: the next milestone the model can
  // still speak to. Past a year the long tail is flat, so today is the end of the chart.
  const horizonDay = [30, 60, 90, 180, 365].find((d) => d > ageDays) ?? ageDays;
  const maxDay = Math.max(horizonDay, actuals.length ? actuals[actuals.length - 1].day : 0, ageDays);
  // Start the curves at the first actual point, or one hour, so the launch window is drawn.
  const startDay = Math.min(actuals.length ? actuals[0].day : 1 / 24, 1 / 24);

  const thumbUrls: Record<number, string> = {};
  for (const t of thumbs) thumbUrls[t.version] = versionThumbUrl(id, t.version);

  const lastSeen = [snapshots[snapshots.length - 1]?.at, samples[samples.length - 1]?.at]
    .filter(Boolean)
    .map((x) => new Date(x as string).getTime())
    .sort((a, b) => b - a)[0];

  const hero = heroThumb(id, thumbs, v.thumbnail_url ?? null);

  return {
    id,
    title: v.title,
    channelId: v.channel_id,
    channelName: v.channel_name,
    publishedAt: new Date(v.published_at).toISOString(),
    views: Number(v.view_count ?? 0),
    ageDays,
    expectedNow: expectedAtAge(score?.baseline ?? null, mult, ageDays, longtail),
    pace: (() => { const exp = expectedAtAge(score?.baseline ?? null, mult, ageDays, longtail); const views = Number(v.view_count ?? 0); return exp && views > 0 ? views / exp : null; })(),
    horizonDay: maxDay,
    sparse: actuals.length <= 3,
    headline: ageDays >= 30 ? 'now' : 'day30',
    thumbUrl: hero.src,
    thumbFallbackUrl: hero.fallback,
    score,
    actuals,
    curve: expectedCurve(score?.baseline ?? null, mult, maxDay, 60, startDay, longtail),
    projected: score ? projectedCurve(score.est30, mult, maxDay, 60, startDay, longtail) : [],
    markers,
    experiments: experiments(v.published_at, samples, markers, now),
    thumbs: thumbs.map((t) => ({ version: t.version, first_seen: new Date(t.first_seen).toISOString(), url: thumbUrls[t.version] })),
    titles: titles.map((t) => ({ version: t.version, title: t.title, first_seen: new Date(t.first_seen).toISOString() })),
    thumbUrls,
    // The launch zoom is only meaningful while the 15-minute samples are still arriving.
    defaultZoom: ageDays < 3 && samples.length > 0 ? '72h' : 'full',
    lastSeen: lastSeen ? new Date(lastSeen).toISOString() : null,
    counts: { snapshots: snapshots.length, samples: samples.length },
  };
}

/** The stored confidence is already a word (early / likely / confirmed); only the model's
 *  "insufficient" needs translating for a reader. */
export function confidenceWord(confidence: string | null | undefined): string {
  const c = (confidence || '').toLowerCase();
  if (!c) return 'unknown';
  return c === 'insufficient' ? 'not enough data' : c;
}

/**
 * The one thing a creator came for, as words. Two readings of the same number:
 * a video past day 30 is judged on where it is now (the day-30 score is history, and is kept
 * as the comparable figure); a young one is judged on where day 30 is heading.
 */
export function verdict(v: VideoPageView): { big: string | null; under: string; aside: string | null } {
  const pct = (x: number) => `${x.toFixed(x < 10 ? 1 : 0)}×`;
  const sc = v.score;
  const conf = sc?.confidence ? confidenceWord(sc.confidence) : null;
  const day30 = sc?.score != null
    ? `${pct(Number(sc.score))} of this channel's normal at day 30${conf && conf !== 'confirmed' ? ` · ${conf} read` : ''}`
    : null;

  if (v.headline === 'now' && v.pace != null && v.expectedNow != null) {
    return {
      big: pct(v.pace),
      under: `${fmt(v.views)} views — a typical ${v.channelName} video has about ${fmt(Math.round(v.expectedNow))} by now`,
      // The day-30 score is the comparable number, but when it rounds to the same ratio as the
      // pace above it, repeating it says nothing.
      aside: day30 && !day30.startsWith(pct(v.pace)) ? day30 : null,
    };
  }
  if (sc?.score != null && sc.baseline != null) {
    return {
      big: pct(Number(sc.score)),
      under: `on track for about ${fmt(Math.round(sc.est30))} views by day 30, against ${fmt(Math.round(sc.baseline))} for a normal ${v.channelName} video`,
      // When the two ratios round the same the pace sentence would just repeat the headline,
      // so only the confidence survives.
      aside: v.pace != null && pct(v.pace) !== pct(Number(sc.score))
        ? `${pct(v.pace)} the channel's usual pace right now${conf ? ` · ${conf} read` : ''}`
        : conf ? `${conf} read` : null,
    };
  }
  return {
    big: null,
    under: `${fmt(v.views)} views. There is not enough history on ${v.channelName} yet to say what normal looks like.`,
    aside: null,
  };
}

function fmt(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
}
