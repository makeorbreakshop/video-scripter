// Presentation logic for the ChannelSmith feed. Pure functions only — the feed row
// components render what these return, so the wording and thresholds are testable
// without mounting React or touching the database.
import { FEED_TYPES } from '../feed/event-types';
import { gapReasonWords, MIN_PRIORS } from '../scoring/score-gaps';

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
  /** Current view count, joined at read time — the TestRow's left column shows it. */
  view_count?: number | null;
  payload: Record<string, any>;
  /**
   * The video's CURRENT video_scores.score, joined at read time (lib/feed/query.ts).
   * An outlier event's payload is written once, when the video first crossed 2x, and the
   * channel baseline is refit under it afterwards — Jay Clouse GmIn1W9V8Rs read 4.47x in its
   * Aug 30 event and 2.79x in video_scores four days later, off the same est30. The event
   * timestamp stays "when it crossed"; the number a card shows is always the live one.
   */
  score?: number | null;
  /** video_scores.n_baseline / .confidence, for saying WHY there is no score. */
  score_n_baseline?: number | null;
  score_confidence?: string | null;
  /** What the score is made of: the day-30 projection, the channel's normal at day 30 (the
   *  display anchor), and -- the score's actual denominator under v5 -- its normal at the
   *  video's own age. */
  score_est30?: number | null;
  score_baseline?: number | null;
  score_typical_at_age?: number | null;
  /** Prior long-form videos on the channel — what separates "new channel" from "young priors". */
  prior_longform?: number | null;
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
  const days = hours / 24;
  if (days < 60) return `${Math.round(days)}d after publish`;
  if (days < 365) return `${Math.round(days / 30.4)}mo after publish`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y after publish`;
}

// ------------------------------------------------------------------ score ----

/** The score a feed event has to reach before it earns the arcade high-score tag. */
export const HIGH_SCORE_AT = 3;

/** The score at which a video first earns an outlier card in the feed. */
export const OUTLIER_AT = 2;

/**
 * The badge's title attribute. It says three things a reader otherwise has to guess: the number
 * is a multiple of what this channel normally does by day 30, it is the current score rather
 * than the one from the day the card is filed under, and 2x is the line that puts a video in
 * the feed at all.
 */
export function scoreTooltip(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'No score yet';
  return `${formatScore(score)} of this channel's normal day-30 views, as of now. `
    + `Videos enter the feed as outliers at ${OUTLIER_AT}×.`;
}

/** Scores are multiples of baseline: one decimal under 10, whole numbers above. */
export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return '—';
  if (score >= 10) return `${Math.round(score)}×`;
  return `${(Math.round(score * 10) / 10).toFixed(1)}×`;
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

/**
 * The live score, when the reader joined one. `undefined` means "no live score column here"
 * (a caller that never joined video_scores) and falls back to the payload; an explicit `null`
 * means "this video has no score row" and wins, because showing a stale one would be a lie.
 */
function liveScore(e: { score?: number | null }): number | null | undefined {
  return e.score === undefined ? undefined : num(e.score);
}

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
      const score = liveScore(e) ?? num(p.score);
      base.score = score;
      base.highScore = isHighScore(score);
      const est30 = num(p.est30), baseline = num(p.baseline);
      const bits: string[] = [];
      if (est30 !== null) bits.push(`${compactNumber(est30)} est. 30-day views`);
      // v5: the score's denominator is the channel's typical AT THE VIDEO'S AGE. `baseline` is
      // C(30), the display anchor, so it is the wrong number to call "at this age".
      if (baseline !== null) bits.push(`typical ${compactNumber(baseline)} by day 30`);
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

// ------------------------------------------------------------------ cards ----
/**
 * One card per video per ET day. A burst of thumbnail tests on one video is one card that
 * lists the versions; a later change on another day is a new card under that day.
 */
export interface FeedCard {
  key: string;
  video_id: string | null;
  channel_id: string | null;
  channel_name: string | null;
  title: string;
  thumbnail_url: string | null;
  href: string | null;
  /** latest activity in the day, drives ordering */
  at: string;
  uploadedAt: string | null;       // set when the day includes the upload itself
  thumbSwaps: Array<{ url: string; version: number | null; at: string; rotation: boolean }>;
  titleChange: { from: string | null; to: string } | null;
  /** The live video_scores.score when the reader joined one, else the crossing event's. */
  score: number | null;
  /** The day held an outlier crossing event — what makes a scoreless day an outlier card. */
  outlier: boolean;
  /** Why there is no score, when there is none: see cardScoreNote. */
  scoreFacts: { nBaseline: number | null; confidence: string | null; priorLongform: number | null } | null;
  events: FeedEventLike[];
}

export function groupCards(events: FeedEventLike[]): Array<{ key: string; cards: FeedCard[] }> {
  return groupByDay(events).map((day) => {
    const byVideo = new Map<string, FeedCard>();
    for (const e of day.events) {
      const k = e.video_id || e.id;
      const p = e.payload || {};
      let c = byVideo.get(k);
      if (!c) {
        c = { key: `${day.key}:${k}`, video_id: e.video_id, channel_id: e.channel_id, channel_name: e.channel_name,
              title: e.video_title || str(p.title) || str(p.new_title) || 'Untitled video', thumbnail_url: e.thumbnail_url,
              href: e.video_id ? `/app/videos/${e.video_id}` : null, at: e.at, uploadedAt: null, thumbSwaps: [], titleChange: null,
              score: null, outlier: false, scoreFacts: null, events: [] };
        byVideo.set(k, c);
      }
      c.events.push(e);
      if (e.at > c.at) c.at = e.at;
      if (e.type === 'upload') c.uploadedAt = e.at;
      if (e.type === 'thumbnail_change' || e.type === 'ab_rotation') {
        const url = str(p.after_url) || e.thumbnail_url; if (url) c.thumbSwaps.push({ url, version: num(p.version), at: e.at, rotation: e.type === 'ab_rotation' });
      }
      if (e.type === 'title_change') c.titleChange = { from: str(p.old_title), to: str(p.new_title) || c.title };
      if (e.type === 'outlier') { c.outlier = true; if (c.score === null) c.score = num(p.score); }
      // The live score, wherever it rides in, is the number the card shows.
      const live = liveScore(e);
      if (live !== undefined) c.score = live;
      if (e.score_n_baseline !== undefined || e.score_confidence !== undefined || e.prior_longform !== undefined) {
        c.scoreFacts = {
          nBaseline: e.score_n_baseline ?? null,
          confidence: e.score_confidence ?? null,
          priorLongform: e.prior_longform ?? null,
        };
      }
    }
    const cards = [...byVideo.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
    for (const c of cards) c.thumbSwaps.sort((a, b) => (a.at < b.at ? -1 : 1));
    return { key: day.key, cards };
  });
}

// ------------------------------------------------------- card presentation ---

export type CardKind = 'upload' | 'title' | 'thumb' | 'combo' | 'outlier';

/**
 * What the card is *about*. An upload wins over any same-day edits — the video being new
 * is the bigger fact — and a score with nothing else that day is an outlier card.
 */
export function cardKind(card: FeedCard): CardKind {
  if (card.uploadedAt) return 'upload';
  const t = !!card.titleChange, th = card.thumbSwaps.length > 0;
  if (t && th) return 'combo';
  if (t) return 'title';
  if (th) return 'thumb';
  // A live score rides on every card now, so it cannot be what makes one an outlier card;
  // the crossing event is.
  if (card.outlier) return 'outlier';
  return 'upload';
}

/** The muted verb phrase in the byline: "<Channel> posted a new video". */
export function cardVerb(card: FeedCard): string {
  switch (cardKind(card)) {
    case 'upload': return 'posted a new video';
    case 'combo': return 'changed the title and thumbnail';
    case 'title': return 'changed the title';
    case 'thumb': return card.thumbSwaps.length > 1
      ? `rotated ${card.thumbSwaps.length} thumbnails`
      : 'swapped the thumbnail';
    case 'outlier': return 'is beating its baseline';
  }
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th". Null for anything that is not a positive integer. */
export function ordinal(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 1) return null;
  const i = Math.round(n);
  const rem100 = i % 100, rem10 = i % 10;
  const suffix = rem100 >= 11 && rem100 <= 13 ? 'th'
    : rem10 === 1 ? 'st' : rem10 === 2 ? 'nd' : rem10 === 3 ? 'rd' : 'th';
  return `${i}${suffix}`;
}

const payloadNums = (card: FeedCard, types: string[], key: string): number[] =>
  card.events.filter((e) => types.includes(e.type))
    .map((e) => num((e.payload || {})[key]))
    .filter((v): v is number => v !== null);

const THUMB_TYPES = ['thumbnail_change', 'ab_rotation'];

/**
 * The muted line under the evidence: what number of change this is and how long after publish
 * it happened. No effect or delta numbers — we tested those and per-change deltas were noise —
 * and no rotation counts or "A/B test": the watcher saw images change, not an experiment.
 */
export function cardMeta(card: FeedCard): string | null {
  const kind = cardKind(card);
  const bits: string[] = [];
  const titleV = Math.max(0, ...payloadNums(card, ['title_change'], 'version'));
  const thumbV = Math.max(0, ...payloadNums(card, THUMB_TYPES, 'version'));

  if (kind === 'combo') {
    const pkg = ordinal(Math.max(titleV, thumbV) || null);
    if (pkg) bits.push(`${pkg} package`);
  } else if (kind === 'title') {
    const o = ordinal(titleV || null);
    if (o) bits.push(`${o} title`);
  } else if (kind === 'thumb') {
    const o = ordinal(thumbV || null);
    if (o) bits.push(`${o} thumbnail`);
  }

  const hours = card.events
    .map((e) => num((e.payload || {}).hours_since_publish))
    .filter((v): v is number => v !== null);
  const when = hours.length ? sincePublish(Math.max(...hours)) : null;
  if (when) bits.push(when);
  return bits.length ? bits.join(' · ') : null;
}

/**
 * The line a card shows where the score would be. A blank badge reads as a broken product;
 * a sentence saying the channel has two videos reads as "wait a week". The cause list is
 * lib/scoring/score-gaps.ts, so the card and scripts/score-gaps.ts agree on the words.
 */
export function cardScoreNote(card: FeedCard): string | null {
  if (card.score !== null) return null;
  const f = card.scoreFacts;
  // No score row at all: the scorer has not reached it yet.
  if (!f || (f.nBaseline === null && f.confidence === null)) {
    return gapReasonWords('never-scored-in-window', card.channel_name);
  }
  const priors = f.priorLongform;
  if (priors !== null && priors >= MIN_PRIORS) return gapReasonWords('priors-unusable', card.channel_name);
  if ((f.nBaseline ?? 0) < MIN_PRIORS) return gapReasonWords('no-channel-baseline', card.channel_name);
  return gapReasonWords('other', card.channel_name);
}

// --------------------------------------------------------------- segments ---
/**
 * The feed's one control: a segmented switch, not two rows of chips. Each segment is a
 * question a creator actually asks ("what did they test?"), so it maps to a set of event
 * types rather than exposing the type names.
 */
export type FeedSegment = 'all' | 'uploads' | 'tests' | 'changes' | 'outliers';

export const FEED_SEGMENTS: Array<{ key: FeedSegment; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'uploads', label: 'Uploads' },
  { key: 'tests', label: 'Tests' },
  { key: 'changes', label: 'Changes' },
  { key: 'outliers', label: 'Outliers' },
];

const SEGMENT_TYPES: Record<FeedSegment, string[] | null> = {
  all: null,
  uploads: ['upload'],
  // A rotation is what the watcher writes when an image comes back: that is the test.
  tests: ['ab_rotation'],
  changes: ['thumbnail_change', 'title_change'],
  outliers: ['outlier'],
};

export function parseSegment(value: string | string[] | null | undefined): FeedSegment {
  const v = Array.isArray(value) ? value[0] : value;
  return FEED_SEGMENTS.some((s) => s.key === v) ? (v as FeedSegment) : 'all';
}

/** Event types for a segment; null means every type. */
export function segmentTypes(segment: FeedSegment): string[] | null {
  return SEGMENT_TYPES[segment] ?? null;
}
