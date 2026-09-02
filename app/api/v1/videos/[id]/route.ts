// GET /api/v1/videos/:id — everything the video page shows: the video, its latest score,
// the view curve, thumbnail and title history, and the events we materialized for it.
import { NextResponse } from 'next/server';
import { q, one } from '@/lib/admin/db';
import { thumbUrl } from '@/lib/thumbs/storage';
import { withApiKey, jsonError } from '@/lib/api/v1';
import { experiments } from '@/lib/app/experiment';
import { mergeActuals, packagingMarkers } from '@/lib/admin/video-curve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIDEO_ID = /^[\w-]{6,20}$/;
// One curve, two sources: daily view_snapshots are the long-run truth, high-resolution
// view_samples cover the launch window. Both are returned as (day since publish, views).
const CURVE_LIMIT = 2000;

export const GET = withApiKey(async (_req, _caller, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!VIDEO_ID.test(id)) return jsonError(400, 'bad_request', 'Malformed video id.');

  const video = await one<any>(
    `select v.id, v.channel_id, v.channel_name, v.title, v.published_at, v.view_count, v.like_count,
            v.comment_count, v.duration, v.thumbnail_url, v.is_short
       from videos v where v.id = $1`,
    [id]
  );
  if (!video) return jsonError(404, 'not_found', 'No such video.');

  const [score, curve, thumbs, titles, events] = await Promise.all([
    one<any>(
      `select model_version, scored_at, snapshot_day, views, est30, baseline, n_baseline,
              score, same_age_ratio, n_same_age, confidence
         from video_scores where video_id = $1`,
      [id]
    ),
    q<any>(
      `select day, views, source from (
         select extract(epoch from ((snapshot_date::timestamptz + interval '12 hours') - $2::timestamptz))/86400.0 as day,
                view_count as views, 'snapshot' as source
           from view_snapshots where video_id = $1
         union all
         select extract(epoch from (sampled_at - $2::timestamptz))/86400.0 as day, view_count as views, 'sample' as source
           from view_samples where video_id = $1
       ) x where day >= 0 order by day limit ${CURVE_LIMIT}`,
      [id, video.published_at]
    ),
    q<any>(
      `select version, first_seen, phash, bytes from thumbnail_versions where video_id = $1 order by version`,
      [id]
    ),
    q<any>(`select version, title, first_seen from title_versions where video_id = $1 order by version`, [id]),
    q<any>(
      `select id::text as id, type, at, payload from feed_events where video_id = $1 order by at desc, id desc limit 200`,
      [id]
    ),
  ]);

  // What each packaging change did to views: views/hour before vs after, with a plain verdict.
  const samplesForExp = curve.filter((c: any) => c.source === 'sample').map((c: any) => ({ at: new Date(new Date(video.published_at).getTime() + c.day * 86_400_000), views: c.views }));
  const markers = packagingMarkers(video.published_at, thumbs, titles);
  const dailyForExp = curve.filter((c: any) => c.source === 'snapshot').map((c: any) => ({ at: new Date(new Date(video.published_at).getTime() + c.day * 86_400_000), views: c.views }));
  const exps = experiments(video.published_at, samplesForExp, markers, Date.now(), dailyForExp);
  void mergeActuals;
  return NextResponse.json({
    experiments: exps.map((e: any) => ({ kind: e.kind, version: e.version, at: e.at, resolution: e.resolution, before_vph: e.before?.vph ?? null, after_vph: e.after?.vph ?? null, ratio: e.ratio ?? null, verdict: e.verdict })),
    video: {
      id: video.id,
      title: video.title,
      channel: { id: video.channel_id, name: video.channel_name },
      published_at: video.published_at,
      duration: video.duration,
      is_short: video.is_short ?? false,
      thumbnail_url: video.thumbnail_url,
      view_count: video.view_count,
      like_count: video.like_count,
      comment_count: video.comment_count,
    },
    score: score
      ? {
          model_version: score.model_version,
          scored_at: score.scored_at,
          snapshot_day: score.snapshot_day,
          views: score.views,
          est30: score.est30,
          baseline: score.baseline,
          n_baseline: score.n_baseline,
          score: score.score,
          same_age_ratio: score.same_age_ratio,
          n_same_age: score.n_same_age,
          confidence: score.confidence,
        }
      : null,
    curve: curve.map((p) => ({ day: Number(p.day), views: Number(p.views), source: p.source })),
    thumbnail_versions: thumbs.map((t) => ({
      version: t.version,
      first_seen: t.first_seen,
      phash: t.phash,
      bytes: t.bytes,
      url: thumbUrl(id, t.version),
    })),
    title_versions: titles.map((t) => ({ version: t.version, title: t.title, first_seen: t.first_seen })),
    events: events.map((e) => ({ id: e.id, type: e.type, at: e.at, payload: e.payload })),
  });
});
