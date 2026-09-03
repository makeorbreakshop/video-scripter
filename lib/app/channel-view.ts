// Presentation logic for /app/channels and the add-channel flow. Pure — no network,
// no database — so the "what does this input mean" and "are we at the limit" rules
// are testable on their own.
import { parseChannelInput } from './channels-core';
import { compactNumber, relativeTime } from './feed-format';
import type { PlanLimits, PlanName } from './plans';

/**
 * What the add-channel box should do with what has been typed so far.
 *  - 'idle'    : too short to act on
 *  - 'search'  : free text -> POST /api/app/channels/search (no YouTube quota)
 *  - 'resolve' : a URL, @handle, video link or UC id -> POST /api/app/channels/resolve
 */
export type AddMode = 'idle' | 'search' | 'resolve';

export const MIN_SEARCH_LEN = 2;

export function addChannelMode(input: string): AddMode {
  const raw = (input || '').trim();
  if (raw.length < MIN_SEARCH_LEN) return 'idle';
  return parseChannelInput(raw).kind === 'search' ? 'search' : 'resolve';
}

export interface ChannelRowLike {
  channel_id: string;
  name: string | null;
  role: string;
  watched_closely: boolean;
  added_at: string;
  lane: string | null;
  backfill_status: string | null;
  thumbnail_url: string | null;
  avatar_url: string | null;
  video_count: number;
  baseline: number | null;
  outliers: number;
  last_packaging_change: string | null;
}

export interface Stat { label: string; value: string }

/** The four numbers each channel card shows, already formatted. */
export function channelStats(row: ChannelRowLike, now: Date = new Date()): Stat[] {
  return [
    { label: 'videos', value: compactNumber(row.video_count) },
    { label: 'baseline', value: row.baseline === null ? '—' : compactNumber(row.baseline) },
    { label: 'outliers', value: compactNumber(row.outliers) },
    {
      label: 'last change',
      value: row.last_packaging_change ? relativeTime(row.last_packaging_change, now) + ' ago' : '—',
    },
  ];
}

export function roleLabel(role: string): string {
  return role === 'self' ? 'Your channel' : 'Competitor';
}

export interface UsageView {
  tracked: string;
  watched: string;
  atTrackedLimit: boolean;
  atWatchedLimit: boolean;
  trackedPct: number;
  unlimited: boolean;
}

/** The plan name as a reader sees it. */
export function planLabel(plan: PlanName | string): string {
  const p = String(plan || '').toLowerCase();
  return p === 'owner' ? 'Owner' : p === 'pro' ? 'Pro' : 'Free';
}

/** Plan usage for the channels header and the settings page. */
export function usageView(
  plan: PlanName, limits: PlanLimits, usage: { tracked: number; watched_closely: number }
): UsageView {
  const tracked = usage?.tracked ?? 0;
  const watched = usage?.watched_closely ?? 0;
  // The owner plan's limits are Infinity: "3 / Infinity" and a 0%-forever meter are worse
  // than no number at all, so an unlimited plan just reports the count.
  const trackedUnlimited = !Number.isFinite(limits.tracked);
  const watchedUnlimited = !Number.isFinite(limits.watchedClosely);
  return {
    tracked: trackedUnlimited ? `${tracked} · unlimited` : `${tracked} / ${limits.tracked}`,
    watched: watchedUnlimited ? `${watched} · unlimited` : `${watched} / ${limits.watchedClosely}`,
    atTrackedLimit: tracked >= limits.tracked,
    atWatchedLimit: watched >= limits.watchedClosely,
    trackedPct: trackedUnlimited ? 0 : limits.tracked > 0 ? Math.min(100, Math.round((tracked / limits.tracked) * 100)) : 0,
    unlimited: trackedUnlimited,
  };
}

/**
 * Merge the tracked-channel ids into search results so the picker can show an
 * "already tracked" state instead of letting the user add a duplicate.
 */
export interface SearchResultLike {
  channel_id: string; name: string; video_count: number;
  tracked_lane: string | null; avatar_url?: string | null; handle?: string | null; subscriber_count?: number | string | null;
}
export interface PickerItem extends SearchResultLike { already: boolean }

export function markAlreadyTracked(results: SearchResultLike[], trackedIds: Iterable<string>): PickerItem[] {
  const owned = new Set(trackedIds);
  return (results || []).map((r) => ({ ...r, already: owned.has(r.channel_id) }));
}

/** Turn an add-channel API failure into something a person can act on. */
export function addChannelError(status: number, body: { error?: string; code?: string } | null): string {
  if (status === 402) return body?.error || 'You are at your plan limit. Upgrade to track more channels.';
  if (status === 404) return body?.error || 'No channel found for that link.';
  if (status === 503) return body?.error || 'YouTube is rate limiting us right now. Try again in a bit.';
  if (status === 401) return 'Your session expired. Reload the page.';
  return body?.error || 'Something went wrong. Try again.';
}

/**
 * YouTube avatar URLs carry their size in the path (`=s800-c-k...`). The picker shows
 * them at 32px, so asking for 800px is why the results felt slow to fill in.
 */
export function avatarAt(url: string | null | undefined, px: number): string | null {
  if (!url) return null;
  return /\.ggpht\.com\//.test(url) ? url.replace(/=s\d+(?=-|$)/, `=s${px}`) : url;
}

/** The one line under a search result: handle · subscribers · videos. */
export function pickerMeta(r: SearchResultLike): string {
  const parts: string[] = [];
  if (r.handle) parts.push(`@${r.handle}`);
  // Postgres hands bigint back as a string; coerce before formatting.
  const subs = r.subscriber_count == null ? null : Number(r.subscriber_count);
  if (subs != null && Number.isFinite(subs)) parts.push(`${compactNumber(subs)} subscribers`);
  parts.push(r.tracked_lane || r.video_count > 0 ? `${compactNumber(r.video_count)} videos` : 'new to us, synced after you add it');
  return parts.join(' · ');
}
