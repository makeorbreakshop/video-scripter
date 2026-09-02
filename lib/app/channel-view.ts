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
  return role === 'self' ? 'YOUR CHANNEL' : 'COMPETITOR';
}

/** Backfill states worth telling the user about; everything else is silent. */
export function backfillNote(row: ChannelRowLike): string | null {
  const s = (row.backfill_status || '').toLowerCase();
  if (s === 'queued') return 'Back catalog queued';
  if (s === 'running') return 'Back catalog importing…';
  if (s === 'failed') return 'Back catalog import failed';
  return null;
}

export interface UsageView {
  tracked: string;
  watched: string;
  atTrackedLimit: boolean;
  atWatchedLimit: boolean;
  trackedPct: number;
}

/** Plan usage for the channels header and the settings page. */
export function usageView(
  plan: PlanName, limits: PlanLimits, usage: { tracked: number; watched_closely: number }
): UsageView {
  const tracked = usage?.tracked ?? 0;
  const watched = usage?.watched_closely ?? 0;
  return {
    tracked: `${tracked} / ${limits.tracked}`,
    watched: `${watched} / ${limits.watchedClosely}`,
    atTrackedLimit: tracked >= limits.tracked,
    atWatchedLimit: watched >= limits.watchedClosely,
    trackedPct: limits.tracked > 0 ? Math.min(100, Math.round((tracked / limits.tracked) * 100)) : 0,
  };
}

/**
 * Merge the tracked-channel ids into search results so the picker can show an
 * "already tracked" state instead of letting the user add a duplicate.
 */
export interface SearchResultLike { channel_id: string; name: string; video_count: number; tracked_lane: string | null }
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
