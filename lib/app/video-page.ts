// Everything the user-facing video page renders, assembled in one place.
//
// The reads and the curve math are NOT reimplemented here: lib/admin/queries.ts videoPage()
// is the single query for a video's series and packaging history, and lib/admin/video-curve.ts
// is the single source of truth for the expected/projected curves and the change markers.
// This module only composes them, adds the thumbnail URLs and the experiment read, and hands
// the result to the page as plain serialisable data.
import { videoPage as adminVideoPage, type VideoPageData } from '../admin/queries';
import { q, one } from '../admin/db';
import {
  mergeActuals, packagingMarkers,
  type Actual, type CurvePoint, type Marker,
  expectedAtAge } from '../admin/video-curve';
import { buildSeries, channelCurve, type SeriesPoint } from './chart-series';
import { gapReasonWords, MIN_PRIORS } from '../scoring/score-gaps';
import { thumbUrl } from '../thumbs/storage';
import { thumbnailVariants, testState, type Variant, type TestState } from './packaging';
import { buildTimeline, timelineTicks, type TimelineClip } from './packaging-timeline';
import { experiments, type Experiment } from './experiment';

/** One state of the live thumbnail. `variant` is the distinct image (A, B …); a rotation back
 *  to an earlier image is a new version but the same variant (lib/app/packaging.ts). */
export type ThumbVersionView = { version: number; first_seen: string; url: string; variant: string; isReturn: boolean };
export type TitleVersionView = { version: number; title: string; first_seen: string };

export type VideoPageView = {
  ageDays: number;
  pace: number | null; // views now ÷ what a typical video on the channel has at this age
  /** What a typical video on this channel has by now — the denominator of `pace`. */
  expectedNow: number | null;
  /** Last day drawn: today for a video past the last forecast milestone, else the next milestone. */
  horizonDay: number;
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
  /**
   * One value per day from publish to the horizon — measured / implied / forecast. This is the
   * whole line the chart draws; `curve` is only the channel's typical path behind it.
   */
  series: SeriesPoint[];
  markers: Marker[];
  experiments: Experiment[];
  thumbs: ThumbVersionView[];
  /** distinct thumbnail images, in first-seen order, with the versions that showed each */
  variants: Variant[];
  /** is this a running Test & Compare, a settled one, or a single swap */
  packaging: TestState;
  /** the packaging history as the timeline's clips: published, the test, the changes, now */
  timeline: TimelineClip[];
  /** mono day ticks above the track */
  timelineTicks: string[];
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


/**
 * Just enough for the top of the page: the video row, its score, and the numbers verdict()
 * reads. Four small indexed reads instead of the full page's snapshot/sample series, so the
 * hero and the verdict paint while loadVideoPage() streams the chart in behind a Suspense
 * boundary.
 */
export type VideoHeadView = {
  id: string;
  title: string;
  channelId: string;
  channelName: string;
  publishedAt: string;
  views: number;
  ageDays: number;
  pace: number | null;
  expectedNow: number | null;
  headline: 'now' | 'day30';
  thumbUrl: string | null;
  thumbFallbackUrl: string | null;
  score: VideoPageData['score'];
  /** Snapshots + samples we hold; 0 means we have never measured this video (verdict says so). */
  observations: number;
};

export async function loadVideoHead(id: string, now: number = Date.now()): Promise<VideoHeadView | null> {
  const [v, score, params, thumbs, obs] = await Promise.all([
    one<any>(
      `select id, title, channel_id, channel_name, published_at, view_count, thumbnail_url
         from videos where id = $1`,
      [id]
    ),
    one<any>(`select s.*, s.snapshot_day as day from video_scores s where s.video_id = $1`, [id]),
    one<{ mult: Record<number, number>; longtail: { ages: number[]; mult: number[] } | null }>(
      `select params->'mult' as mult, params->'longtail' as longtail
         from score_params where model_version = 'v3.0' order by fitted_at desc limit 1`
    ),
    q<{ version: number; r2_uploaded_at: string | null }>(
      `select version, r2_uploaded_at from thumbnail_versions where video_id = $1 order by version`,
      [id]
    ),
    // Two index-only counts: what separates "we have no baseline" from "we have never
    // measured this video", which the verdict has to be able to say out loud.
    one<{ n: string }>(
      `select ((select count(*) from view_samples s where s.video_id = $1)
             + (select count(*) from view_snapshots s where s.video_id = $1))::text as n`,
      [id]
    ),
  ]);
  if (!v) return null;

  const mult = params?.mult ?? {};
  const longtail = params?.longtail ?? null;
  const ageDays = (now - new Date(v.published_at).getTime()) / 86_400_000;
  const views = Number(v.view_count ?? 0);
  const expectedNow = expectedAtAge(score?.baseline ?? null, mult, ageDays, longtail);
  const hero = heroThumb(id, thumbs, v.thumbnail_url ?? null);

  return {
    id,
    title: v.title,
    channelId: v.channel_id,
    channelName: v.channel_name,
    publishedAt: new Date(v.published_at).toISOString(),
    views,
    ageDays,
    expectedNow,
    pace: expectedNow && views > 0 ? views / expectedNow : null,
    headline: ageDays >= 30 ? 'now' : 'day30',
    thumbUrl: hero.src,
    thumbFallbackUrl: hero.fallback,
    score,
    observations: Number(obs?.n ?? 0),
  };
}

export async function loadVideoPage(id: string, now: number = Date.now()): Promise<VideoPageView | null> {
  const { video: v, snapshots, samples, thumbs, titles, score, mult, longtail, bands } = await adminVideoPage(id);
  if (!v) return null;

  const actuals = mergeActuals(v.published_at, snapshots, samples);
  const markers = packagingMarkers(v.published_at, thumbs, titles);
  const ageDays = (now - new Date(v.published_at).getTime()) / 86_400_000;
  // Draw the whole life, then a little forecast past today: the next milestone the model can
  // still speak to. Past a year the long tail is flat, so today is the end of the chart.
  const horizonDay = [30, 60, 90, 180, 365].find((d) => d > ageDays) ?? ageDays;
  const maxDay = Math.max(horizonDay, actuals.length ? actuals[actuals.length - 1].day : 0, ageDays);

  const thumbUrls: Record<number, string> = {};
  for (const t of thumbs) thumbUrls[t.version] = versionThumbUrl(id, t.version);

  const lastSeen = [snapshots[snapshots.length - 1]?.at, samples[samples.length - 1]?.at]
    .filter(Boolean)
    .map((x) => new Date(x as string).getTime())
    .sort((a, b) => b - a)[0];

  const hero = heroThumb(id, thumbs, v.thumbnail_url ?? null);
  const thumbRows = thumbs.map((t) => ({ version: t.version, sha256: t.sha256 ?? null, phash: t.phash ?? null, first_seen: t.first_seen }));
  const { variants, states } = thumbnailVariants(thumbRows);
  const variantOf = new Map(states.map((s) => [s.version, s]));

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
    headline: ageDays >= 30 ? 'now' : 'day30',
    thumbUrl: hero.src,
    thumbFallbackUrl: hero.fallback,
    score,
    actuals,
    ...(() => {
      // One grid for both lines: the series days. See channelCurve for why they cannot differ.
      const series = buildSeries({
        actuals,
        baseline: score?.baseline ?? null,
        est30: score?.est30 ?? null,
        mult,
        longtail,
        horizonDay: maxDay,
        ageDays,
        bands,
      });
      return { series, curve: channelCurve(series, score?.baseline ?? null, mult, longtail) };
    })(),
    markers,
    experiments: experiments(v.published_at, samples, markers, now, snapshots.map((p: any) => ({ at: new Date(new Date(p.at).getTime()).toISOString(), views: p.views }))),
    thumbs: thumbs.map((t) => ({ version: t.version, first_seen: new Date(t.first_seen).toISOString(), url: thumbUrls[t.version],
      variant: variantOf.get(t.version)?.variant ?? 'A', isReturn: variantOf.get(t.version)?.isReturn ?? false })),
    variants,
    packaging: testState(thumbRows, now),
    ...(() => {
      // The timeline is built here rather than in the page so the clip list is plain
      // serialisable data by the time it crosses into the client component.
      const clips = buildTimeline({
        publishedAt: new Date(v.published_at).toISOString(),
        thumbs: thumbRows.map((t) => ({ ...t, first_seen: new Date(t.first_seen).toISOString(), url: thumbUrls[t.version] })),
        titles: titles.map((t) => ({ version: t.version, title: t.title, first_seen: new Date(t.first_seen).toISOString() })),
        score: score?.score != null ? Number(score.score) : null,
        now,
      });
      return { timeline: clips, timelineTicks: timelineTicks(clips) };
    })(),
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

/** verdict() reads only the headline numbers, so the fast head view can produce it too. */
export type VideoVerdictInput = Pick<VideoPageView,
  'score' | 'headline' | 'pace' | 'expectedNow' | 'views' | 'ageDays' | 'channelName'> & {
  /** Snapshots + samples we hold for this video; 0 means we have not measured it at all. */
  observations?: number;
  /** Prior long-form videos on the channel, when the caller knows it. */
  priorLongform?: number | null;
};

/**
 * The one thing a creator came for, as words. Two readings of the same number:
 * a video past day 30 is judged on where it is now (the day-30 score is history, and is kept
 * as the comparable figure); a young one is judged on where day 30 is heading.
 */
export function verdict(v: VideoVerdictInput): { big: string | null; under: string; aside: string | null; over: boolean } {
  const pct = (x: number) => `${x.toFixed(x < 10 ? 1 : 0)}×`;
  const sc = v.score;
  const conf = sc?.confidence ? confidenceWord(sc.confidence) : null;
  const day30 = sc?.score != null
    ? `${pct(Number(sc.score))} of this channel's normal at day 30${conf && conf !== 'confirmed' ? ` · ${conf} read` : ''}`
    : null;

  if (v.headline === 'now' && v.pace != null && v.expectedNow != null) {
    return {
      big: pct(v.pace),
      over: v.pace >= 1,
      under: `${fmt(v.views)} views · typical ${fmt(Math.round(v.expectedNow))} by now`,
      // The day-30 score is the comparable number, but when it rounds to the same ratio as the
      // pace above it, repeating it says nothing.
      aside: day30 && !day30.startsWith(pct(v.pace)) ? day30 : null,
    };
  }
  if (sc?.score != null && sc.baseline != null) {
    return {
      big: pct(Number(sc.score)),
      over: Number(sc.score) >= 1,
      under: `on pace for ${fmt(Math.round(sc.est30))} by day 30 · typical ${fmt(Math.round(sc.baseline))}`,
      // One multiplier per page, and only numbers the headline is made of. The measured count
      // and the read's confidence are the whole second line.
      aside: [`${fmt(v.views)} views at ${age(v.ageDays)}`, conf ? `${conf} read` : null].filter(Boolean).join(' · '),
    };
  }
  // No score. Name the cause instead of leaving a blank: a reader who sees nothing assumes the
  // product is broken, one who is told the channel has two prior videos knows to wait.
  // (lib/scoring/score-gaps.ts is the one cause list; scripts/score-gaps.ts counts the same ones.)
  const bucket =
    v.observations === 0 ? 'no-observations'
    : (v.priorLongform ?? 0) >= MIN_PRIORS ? 'priors-unusable'
    : sc && sc.baseline == null ? 'no-channel-baseline'
    : sc ? 'no-channel-baseline'
    : 'never-scored-in-window';
  return {
    big: null,
    over: false,
    under: `${fmt(v.views)} views at ${age(v.ageDays)} · ${gapReasonWords(bucket, v.channelName)}`,
    aside: null,
  };
}

function age(days: number): string {
  if (days < 2) return `${Math.max(1, Math.round(days * 24))}h`;
  return `${Math.round(days)}d`;
}

function fmt(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
}
