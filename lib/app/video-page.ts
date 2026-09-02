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
} from '../admin/video-curve';
import { thumbUrl } from '../thumbs/storage';
import { experiments, type Experiment } from './experiment';

export type ThumbVersionView = { version: number; first_seen: string; url: string };
export type TitleVersionView = { version: number; title: string; first_seen: string };

export type VideoPageView = {
  id: string;
  title: string;
  channelId: string;
  channelName: string;
  publishedAt: string;
  views: number;
  thumbUrl: string | null;
  score: VideoPageData['score'];
  actuals: Actual[];
  curve: CurvePoint[];
  projected: ProjPoint[];
  markers: Marker[];
  experiments: Experiment[];
  thumbs: ThumbVersionView[];
  titles: TitleVersionView[];
  thumbUrls: Record<number, string>;
  defaultZoom: '72h' | '30d';
  lastSeen: string | null;
  counts: { snapshots: number; samples: number };
};

/** R2 first (public, immutable, zero-egress); the archive route is the signed-in fallback. */
export function versionThumbUrl(videoId: string, version: number): string {
  return thumbUrl(videoId, version) ?? `/api/admin/thumb/${videoId}/${version}`;
}

export function archiveFallbackUrl(videoId: string, version: number): string {
  return `/api/admin/thumb/${videoId}/${version}`;
}

export async function loadVideoPage(id: string, now: number = Date.now()): Promise<VideoPageView | null> {
  const { video: v, snapshots, samples, thumbs, titles, score, mult } = await adminVideoPage(id);
  if (!v) return null;

  const actuals = mergeActuals(v.published_at, snapshots, samples);
  const markers = packagingMarkers(v.published_at, thumbs, titles);
  const ageDays = (now - new Date(v.published_at).getTime()) / 86_400_000;
  const maxDay = Math.max(30, actuals.length ? actuals[actuals.length - 1].day : 0, ageDays);
  // Start the curves at the first actual point, or one hour, so the launch window is drawn.
  const startDay = Math.min(actuals.length ? actuals[0].day : 1 / 24, 1 / 24);

  const thumbUrls: Record<number, string> = {};
  for (const t of thumbs) thumbUrls[t.version] = versionThumbUrl(id, t.version);

  const lastSeen = [snapshots[snapshots.length - 1]?.at, samples[samples.length - 1]?.at]
    .filter(Boolean)
    .map((x) => new Date(x as string).getTime())
    .sort((a, b) => b - a)[0];

  const latest = thumbs.length ? thumbs[thumbs.length - 1].version : null;

  return {
    id,
    title: v.title,
    channelId: v.channel_id,
    channelName: v.channel_name,
    publishedAt: new Date(v.published_at).toISOString(),
    views: Number(v.view_count ?? 0),
    thumbUrl: latest != null ? thumbUrls[latest] : v.thumbnail_url ?? null,
    score,
    actuals,
    curve: expectedCurve(score?.baseline ?? null, mult, maxDay, 60, startDay),
    projected: score ? projectedCurve(score.est30, mult, maxDay, 60, startDay) : [],
    markers,
    experiments: experiments(v.published_at, samples, markers, now),
    thumbs: thumbs.map((t) => ({ version: t.version, first_seen: new Date(t.first_seen).toISOString(), url: thumbUrls[t.version] })),
    titles: titles.map((t) => ({ version: t.version, title: t.title, first_seen: new Date(t.first_seen).toISOString() })),
    thumbUrls,
    defaultZoom: ageDays < 3 ? '72h' : '30d',
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
