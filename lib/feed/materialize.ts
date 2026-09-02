// Pure feed-event materialization. Takes rows read from the source tables and returns the
// events they imply; scripts/feed-materialize.ts does the I/O and the upsert. Keeping the
// mapping pure is what makes the interesting cases (A/B rotation, first outlier) testable.
import { thumbUrl } from '../thumbs/storage';

export type FeedEventType = 'upload' | 'thumbnail_change' | 'ab_rotation' | 'title_change' | 'outlier';

export interface FeedEvent {
  type: FeedEventType;
  channel_id: string | null;
  video_id: string;
  at: Date;
  payload: Record<string, unknown>;
  dedupe_key: string;
}

const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString();
const key = (type: string, videoId: string, suffix: string | number) => `${type}:${videoId}:${suffix}`;

// ---------- uploads ----------

export interface UploadRow {
  video_id: string;
  channel_id: string | null;
  channel_name?: string | null;
  title?: string | null;
  published_at: Date | string;
  /** When our importer first saw the row; the event fires at max(published, imported). */
  import_date?: Date | string | null;
}

export function uploadEvents(rows: UploadRow[]): FeedEvent[] {
  return rows.map((r) => {
    const published = new Date(r.published_at);
    // An upload happened when it was published, never when we imported it. The feed is a
    // reverse-chronological history of the tracked channels, so backfilled videos slot into
    // their real place in time.
    const at = published;
    return {
      type: 'upload' as const,
      channel_id: r.channel_id ?? null,
      video_id: r.video_id,
      at,
      payload: { title: r.title ?? null, published_at: iso(published) },
      dedupe_key: key('upload', r.video_id, iso(published)),
    };
  });
}

// ---------- thumbnails ----------

export interface ThumbVersionRow {
  video_id: string;
  channel_id: string | null;
  version: number;
  phash: string | null;
  first_seen: Date | string;
  published_at: Date | string | null;
}

/**
 * Every thumbnail version above 1 is a change. When the new version's phash equals a phash we
 * already saw on an *earlier* version of the same video, the creator has rotated back to a
 * previous image — that is an A/B test, not a fresh swap, so it gets its own type.
 * `priorPhashes` maps video_id -> phashes of versions strictly below the one being considered
 * (the caller reads them once per video; identical phashes on adjacent versions are impossible
 * because the watcher only inserts a version when the picture changed).
 */
export function thumbnailEvents(rows: ThumbVersionRow[], priorPhashes: Map<string, Set<string>>): FeedEvent[] {
  const out: FeedEvent[] = [];
  for (const r of rows) {
    if (r.version <= 1) continue;
    const at = new Date(r.first_seen);
    const published = r.published_at ? new Date(r.published_at) : null;
    const hoursSincePublish = published ? Math.round(((at.getTime() - published.getTime()) / 3_600_000) * 10) / 10 : null;
    const rotation = !!(r.phash && priorPhashes.get(r.video_id)?.has(r.phash));
    const type: FeedEventType = rotation ? 'ab_rotation' : 'thumbnail_change';
    out.push({
      type,
      channel_id: r.channel_id ?? null,
      video_id: r.video_id,
      at,
      payload: {
        version: r.version,
        before_url: thumbUrl(r.video_id, r.version - 1),
        after_url: thumbUrl(r.video_id, r.version),
        hours_since_publish: hoursSincePublish,
        ...(rotation ? { phash: r.phash } : {}),
      },
      dedupe_key: key(type, r.video_id, r.version),
    });
  }
  return out;
}

// ---------- titles ----------

export interface TitleVersionRow {
  video_id: string;
  channel_id: string | null;
  version: number;
  title: string;
  previous_title: string | null;
  first_seen: Date | string;
  published_at?: Date | string | null;
}

export function titleEvents(rows: TitleVersionRow[]): FeedEvent[] {
  const out: FeedEvent[] = [];
  for (const r of rows) {
    if (r.version <= 1) continue;
    const at = new Date(r.first_seen);
    const published = r.published_at ? new Date(r.published_at) : null;
    out.push({
      type: 'title_change',
      channel_id: r.channel_id ?? null,
      video_id: r.video_id,
      at,
      payload: {
        version: r.version,
        old_title: r.previous_title,
        new_title: r.title,
        hours_since_publish: published ? Math.round(((at.getTime() - published.getTime()) / 3_600_000) * 10) / 10 : null,
      },
      dedupe_key: key('title_change', r.video_id, r.version),
    });
  }
  return out;
}

// ---------- outliers ----------

export const OUTLIER_MIN_SCORE = 2;
export const OUTLIER_CONFIDENCES = ['likely', 'confirmed'] as const;

export interface ScoreRow {
  video_id: string;
  channel_id: string | null;
  score: number | null;
  est30: number | null;
  baseline: number | null;
  confidence: string;
  scored_at: Date | string;
  published_at?: Date | string | null;
  import_date?: Date | string | null;
}

/**
 * A video becomes an outlier once. `alreadyFlagged` is the set of video_ids that already have an
 * outlier event, so a video that keeps climbing does not spam the feed every hourly scoring run.
 */
export function outlierEvents(rows: ScoreRow[], alreadyFlagged: Set<string>): FeedEvent[] {
  const out: FeedEvent[] = [];
  const seen = new Set(alreadyFlagged);
  for (const r of rows) {
    if (seen.has(r.video_id)) continue;
    if (r.score == null || r.score < OUTLIER_MIN_SCORE) continue;
    if (!(OUTLIER_CONFIDENCES as readonly string[]).includes(r.confidence)) continue;
    // News time: when the video crossed the line if we were watching, otherwise (a backfilled
    // final score on an old video) the day it would have been confirmed, publish + 30 days.
    const scored = new Date(r.scored_at);
    const published = r.published_at ? new Date(r.published_at) : null;
    const imported = r.import_date ? new Date(r.import_date) : null;
    const DAY = 86_400_000;
    // A video we started watching more than a day after it was published never had a live
    // "crossed the line" moment we observed, so its score joins the publish-day card.
    const backfilled = published && imported && imported.getTime() - published.getTime() > DAY;
    const at = backfilled ? published!
      : published && scored.getTime() - published.getTime() > 35 * DAY ? new Date(published.getTime() + 30 * DAY)
      : scored;
    seen.add(r.video_id);
    out.push({
      type: 'outlier',
      channel_id: r.channel_id ?? null,
      video_id: r.video_id,
      at,
      payload: { score: r.score, est30: r.est30, baseline: r.baseline, confidence: r.confidence },
      dedupe_key: key('outlier', r.video_id, iso(at)),
    });
  }
  return out;
}
