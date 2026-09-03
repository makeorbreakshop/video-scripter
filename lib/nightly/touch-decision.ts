// What the touch-queue drainer does with one video row. Pure, so it is testable without
// Postgres or the YouTube API.
//
// Modes: 'click' (a user opened the video), 'websub' (YouTube pushed the upload, or the RSS
// poller saw a new id), 'feed' / 'passive' (the extension saw the id in a feed or on a page).
// Feed and passive rows used to be discovery signals only — resolve the channel, never import
// the video. That dropped fresh uploads even from channels we already tracked (Greg Isenberg's
// 9_SZFIW7tus, 2026-09-02: seen 10 minutes after publish, imported 12.5h later by the nightly
// ingest, launch tracking lost). Decision 2026-09-03: every video we see imports, whichever door
// it came in through; a channel we have never seen is additionally surfaced as a candidate so
// it gets enrolled. `trackedOnly` is the back-off knob for when API budget forces it: with it
// on, feed/passive uploads from unknown channels go back to being signals only.
import { isTracked, type KnownChannels } from './enrollment-core';

export type TouchVideoRow = { mode: string; ref: string; channelId: string | null | undefined };
export type TouchResult = 'already-tracked' | 'imported' | 'candidate-signal';
export type TouchDecision = {
  result: TouchResult;
  tier: 0 | 1 | null;
  /** The channel is in none of our registries: surface it as a candidate for enrollment. */
  unknownChannel: boolean;
};

export function decideVideoRow(
  row: TouchVideoRow,
  knownVideos: Set<string>,
  known: KnownChannels,
  opts: { trackedOnly?: boolean } = {},
): TouchDecision {
  const unknownChannel = !!row.channelId && !isTracked(row.channelId, known);
  if (knownVideos.has(row.ref)) return { result: 'already-tracked', tier: null, unknownChannel };
  if (row.mode === 'click') return { result: 'imported', tier: 1, unknownChannel };
  if (row.mode === 'websub') return { result: 'imported', tier: 0, unknownChannel };
  // feed / passive: an upload is an upload. Only the back-off knob turns unknown-channel
  // sightings back into signals.
  if (opts.trackedOnly && (unknownChannel || !row.channelId)) return { result: 'candidate-signal', tier: null, unknownChannel };
  if (!row.channelId) return { result: 'candidate-signal', tier: null, unknownChannel };
  return { result: 'imported', tier: 0, unknownChannel };
}

/**
 * Which channels count as "known through corpus videos" for enrollment. A channel whose
 * every video was imported inside the last `graceMs` is not one we track yet — the drainer
 * just imported its first upload seconds ago (or the nightly ingest minutes ago) and it still
 * needs a discovered_channels row, WebSub, and RSS. Without this, importing an unknown
 * channel's upload made the channel look tracked to planEnrollment in the same drain
 * (observed 2026-09-03: 47 candidates surfaced, 0 enrolled).
 */
export const CORPUS_GRACE_MS = 3_600_000;
export function corpusTrackedChannels(
  rows: { channel_id: string; first_import: string | Date | null }[],
  now: number = Date.now(),
  graceMs: number = CORPUS_GRACE_MS,
): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (!r.first_import) { out.add(r.channel_id); continue; } // legacy rows without import_date predate the registries
    if (now - new Date(r.first_import).getTime() >= graceMs) out.add(r.channel_id);
  }
  return out;
}
