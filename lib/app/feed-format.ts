// Presentation logic for the ChannelSmith feed. Pure functions only — the feed row
// components render what these return, so the wording and thresholds are testable
// without mounting React or touching the database.
import { FEED_TYPES } from '../feed/event-types';

export interface FeedEventLike {
  id: string;
  type: string;
  at: string;
  channel_id: string | null;
  channel_name: string | null;
  video_id: string | null;
  video_title: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  payload: Record<string, any>;
}

// ------------------------------------------------------------------- time ----

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** Compact, feed-column relative time. Anything older than ~a year reads as a date. */
export function relativeTime(at: string | Date, now: Date = new Date()): string {
  const t = at instanceof Date ? at.getTime() : Date.parse(at);
  if (Number.isNaN(t)) return '';
  const d = now.getTime() - t;
  if (d < 0) return 'now';
  if (d < MIN) return 'now';
  if (d < HOUR) return `${Math.floor(d / MIN)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d`;
  if (d < 365 * DAY) return `${Math.floor(d / (7 * DAY))}w`;
  return new Date(t).toISOString().slice(0, 10);
}

const ET = 'America/New_York';

/**
 * Absolute, unambiguous event time in Brandon's timezone: "Aug 29 · 1:57 PM ET".
 * The feed is a history, so the row leads with when a thing actually happened; the
 * relative form ("3d") stays in the title attribute.
 */
export function etTimestamp(at: string | Date | null | undefined): string {
  if (!at) return '';
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-US', { timeZone: ET, month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time} ET`;
}

/** ET calendar day, as YYYY-MM-DD — the key rows are grouped under. */
export function etDayKey(at: string | Date | null | undefined): string {
  if (!at) return '';
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  // en-CA gives ISO-shaped dates, which sort and compare as strings.
  return d.toLocaleDateString('en-CA', { timeZone: ET });
}

/** Heading for a day divider: Today / Yesterday / "Saturday, Aug 30, 2026". */
export function dayDividerLabel(at: string | Date, now: Date = new Date()): string {
  const key = etDayKey(at);
  if (!key) return '';
  if (key === etDayKey(now)) return 'Today';
  if (key === etDayKey(new Date(now.getTime() - DAY))) return 'Yesterday';
  const d = at instanceof Date ? at : new Date(at);
  const opts: Intl.DateTimeFormatOptions = { timeZone: ET, weekday: 'long', month: 'short', day: 'numeric' };
  if (key.slice(0, 4) !== etDayKey(now).slice(0, 4)) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

/** Split an already-sorted feed page into contiguous day runs, newest first. */
export function groupByDay<T extends { at: string }>(events: T[]): Array<{ key: string; events: T[] }> {
  const out: Array<{ key: string; events: T[] }> = [];
  for (const e of events || []) {
    const key = etDayKey(e.at);
    const last = out[out.length - 1];
    if (last && last.key === key) last.events.push(e);
    else out.push({ key, events: [e] });
  }
  return out;
}

/** "3.2 hours after publish" style qualifier; null when we do not know the publish time. */
export function sincePublish(hours: number | null | undefined): string | null {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return null;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m after publish`;
  if (hours < 48) return `${Math.round(hours)}h after publish`;
  return `${Math.round(hours / 24)}d after publish`;
}

// ------------------------------------------------------------------ score ----

/** The score a feed event has to reach before it earns the arcade high-score tag. */
export const HIGH_SCORE_AT = 3;

/** Scores are multiples of baseline: one decimal under 10, whole numbers above. */
export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return '—';
  if (score >= 10) return `${Math.round(score)}x`;
  return `${(Math.round(score * 10) / 10).toFixed(1)}x`;
}

export function isHighScore(score: number | null | undefined): boolean {
  return Number.isFinite(score as number) && (score as number) >= HIGH_SCORE_AT;
}

/** 1_234_567 -> "1.2M". Used for view counts and video counts. */
export function compactNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs < 1_000) return String(Math.round(n));
  if (abs < 1_000_000) return `${(n / 1_000).toFixed(abs < 10_000 ? 1 : 0)}K`;
  if (abs < 1_000_000_000) return `${(n / 1_000_000).toFixed(abs < 10_000_000 ? 1 : 0)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

// ------------------------------------------------------------------- rows ----

export interface FeedRowView {
  /**
   * Short tag for the kind of event — null for an upload, whose thumbnail, channel and
   * timestamp already say what it is. A label plus a "New upload" line said it twice.
   */
  label: string | null;
  /** One line saying what changed. */
  headline: string;
  /** Optional supporting line (old title, timing, baseline). */
  detail: string | null;
  /** Thumbnails to show side by side; one entry for everything but a swap. */
  thumbs: Array<{ url: string; caption?: string }>;
  score: number | null;
  highScore: boolean;
  href: string | null;
  /** 'large' is the YouTube-home card an upload gets; everything else stays compact. */
  thumbSize: 'large' | 'small';
}

export const TYPE_LABELS: Record<string, string> = {
  upload: 'UPLOAD',
  thumbnail_change: 'THUMB SWAP',
  title_change: 'TITLE',
  ab_rotation: 'A/B TEST',
  outlier: 'OUTLIER',
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Everything a feed row needs, derived from the event and its payload. */
export function feedRowView(e: FeedEventLike): FeedRowView {
  const p = e.payload || {};
  const title = e.video_title || str(p.title) || str(p.new_title) || 'Untitled video';
  const href = e.video_id ? `/app/videos/${e.video_id}` : null;
  const base: FeedRowView = {
    label: TYPE_LABELS[e.type] || e.type.replace(/_/g, ' ').toUpperCase(),
    headline: title,
    detail: null,
    thumbs: e.thumbnail_url ? [{ url: e.thumbnail_url }] : [],
    score: null,
    highScore: false,
    href,
    thumbSize: 'small',
  };

  switch (e.type) {
    case 'upload':
      // No tag and no "New upload" line: the big thumbnail, the channel and the publish
      // time already read as "this channel posted this then".
      base.label = null;
      base.thumbSize = 'large';
      return base;

    case 'thumbnail_change':
    case 'ab_rotation': {
      const before = str(p.before_url), after = str(p.after_url);
      base.thumbs = [
        ...(before ? [{ url: before, caption: 'before' }] : []),
        ...(after ? [{ url: after, caption: 'after' }] : []),
      ];
      if (!base.thumbs.length && e.thumbnail_url) base.thumbs = [{ url: e.thumbnail_url }];
      const when = sincePublish(num(p.hours_since_publish));
      const what = e.type === 'ab_rotation'
        ? `Rotated back to an earlier thumbnail (v${num(p.version) ?? '?'})`
        : `New thumbnail (v${num(p.version) ?? '?'})`;
      base.detail = when ? `${what} · ${when}` : what;
      return base;
    }

    case 'title_change': {
      const oldTitle = str(p.old_title);
      base.headline = str(p.new_title) || title;
      const when = sincePublish(num(p.hours_since_publish));
      base.detail = oldTitle
        ? `was "${oldTitle}"${when ? ` · ${when}` : ''}`
        : when || 'Title changed';
      return base;
    }

    case 'outlier': {
      const score = num(p.score);
      base.score = score;
      base.highScore = isHighScore(score);
      const est30 = num(p.est30), baseline = num(p.baseline);
      const bits: string[] = [];
      if (est30 !== null) bits.push(`${compactNumber(est30)} est. 30-day views`);
      if (baseline !== null) bits.push(`baseline ${compactNumber(baseline)}`);
      base.detail = bits.length ? bits.join(' · ') : 'Beat its channel baseline';
      return base;
    }

    default:
      return base;
  }
}

// ---------------------------------------------------------------- filters ----

export const FILTER_CHIPS: Array<{ type: string; label: string }> = FEED_TYPES.map((t) => ({
  type: t,
  label: TYPE_LABELS[t] || t,
}));

/** Chip click: add or drop one type, keeping the canonical FEED_TYPES order. */
export function toggleType(current: string[], type: string): string[] {
  if (!FEED_TYPES.includes(type)) return current;
  const has = current.includes(type);
  const next = has ? current.filter((t) => t !== type) : [...current, type];
  return FEED_TYPES.filter((t) => next.includes(t));
}

/** Query string for the feed route; omits empty params so pages cache-key alike. */
export function feedQuery(opts: { cursor?: string | null; limit?: number | null; types?: string[] | null }): string {
  const p = new URLSearchParams();
  if (opts.cursor) p.set('cursor', opts.cursor);
  if (opts.limit) p.set('limit', String(opts.limit));
  const types = (opts.types || []).filter((t) => FEED_TYPES.includes(t));
  if (types.length && types.length < FEED_TYPES.length) p.set('types', types.join(','));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Server side of `feedQuery`: read the request's params back into feedFor options. */
export function parseFeedParams(sp: URLSearchParams): { cursor: string | null; limit: number; types: string[] | null } {
  const rawLimit = parseInt(sp.get('limit') || '', 10);
  const types = (sp.get('types') || '').split(',').map((t) => t.trim()).filter((t) => FEED_TYPES.includes(t));
  return {
    cursor: sp.get('cursor') || null,
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 25,
    types: types.length ? [...new Set(types)] : null,
  };
}
