// Pure policy for replaying rss-poll's pending buffer. scripts/rss-poll.ts does the I/O.
//
// Incident 2026-09-11 → 2026-09-22: one 3.9 MB buffer (14,460 rss_samples) was replayed as a
// single flush, the rss_samples statement-level trigger pushed it past statement_timeout, and
// the replay failed CLOSED on every tick for 11 days — nothing new was polled. So:
//   - a buffer is split into bounded chunks (default ≤ 1,000 rss_samples each), grouped by
//     channel so each chunk carries the feed response whose evidence its samples need;
//   - progress is persisted after every chunk, so a crash never re-flushes written rows;
//   - a chunk that fails MAX_REPLAY_ATTEMPTS consecutive ticks is quarantined and polling
//     continues.
import type { FeedResponse } from './response-freshness';

export interface Buffers {
  responses: FeedResponse[];
  samples: { video_id: string; at: string; views: number | null; likes: number | null }[];
  /** Videos whose title we looked at, changed or not. This is the evidence the 7-day rule reads. */
  observed: string[];
  titleVersions: { video_id: string; version: number; title: string; first_seen: string; backfill: boolean }[];
  videoTitles: { video_id: string; title: string }[];
  /** Real changes only: re-open the stats lane's 5-minute ladder. */
  reentries: string[];
  /** Syncs and unchanged: just stamp that we looked. */
  titleChecks: string[];
  descVersions: { video_id: string; version: number; sha256: string; description: string; first_seen: string; backfill: boolean }[];
  dueNow: { video_id: string; version: number }[];
  touchQueue: { ref: string; source_url: string }[];
  channels: { channel_id: string; status: number | null; body_sha: string | null; etag: string | null;
              interval_sec: number | null; backoff_until: string | null; clear_woken: boolean }[];
  /** When the tick that produced this buffer journaled it. Carried onto every chunk. */
  journaledAt?: string;
}

export const BUFFER_KEYS: (keyof Buffers)[] = [
  'responses', 'samples', 'observed', 'titleVersions', 'videoTitles', 'reentries',
  'titleChecks', 'descVersions', 'dueNow', 'touchQueue', 'channels',
];

export const emptyBuffers = (): Buffers => ({
  responses: [], samples: [], observed: [], titleVersions: [], videoTitles: [], reentries: [],
  titleChecks: [], descVersions: [], dueNow: [], touchQueue: [], channels: [],
});

/**
 * rss_samples per flush. MEASURED 2026-09-22 (EXPLAIN ANALYZE, rolled back): the insert plus its
 * statement-level queue_rss_samples_insert trigger costs ~3.3 ms/row — 200 rows 0.65 s, 2,000
 * rows 7.2 s — so one 39K-row statement blows the 30 s timeout. 200-row chunks spent most of
 * their ~5 s on per-chunk overhead (the other ten statements); 1,000 keeps each sample
 * statement near 3.5 s, well inside the timeout, with 5x fewer round trips.
 */
export const REPLAY_MAX_SAMPLES = 1000;
/** Cap on every other row kind per chunk (stamps are cheap, but still bounded). */
export const REPLAY_MAX_ROWS = 5000;
export const MAX_REPLAY_ATTEMPTS = 3;
/** Past this age a buffer's control-plane rows are stale and would overwrite fresher state. */
export const STALE_BUFFER_MS = 60 * 60 * 1000;

/**
 * The full replay plan for a pending file's lines: each line is judged stale or fresh on its OWN
 * age (merging first would let one fresh line vouch for an 11-day-old one), then split.
 */
export function planReplay(lines: Partial<Buffers>[], now: Date, maxSamples = REPLAY_MAX_SAMPLES): { chunks: Buffers[]; staleLines: number } {
  let staleLines = 0;
  // Lines judged alike (same staleness, same journal stamp) are merged before splitting, so a
  // file already normalized into small chunks is re-packed at the current chunk size.
  const groups = new Map<string, { parts: Buffers[]; journaledAt?: string }>();
  for (const line of lines) {
    const whole = mergeBuffers([line]);
    whole.journaledAt = line.journaledAt;
    const { buffer, stale } = stripStaleControlRows(whole, now);
    if (stale) staleLines++;
    const key = `${stale}|${line.journaledAt ?? ''}`;
    const g = groups.get(key) ?? { parts: [], journaledAt: line.journaledAt };
    g.parts.push(buffer);
    groups.set(key, g);
  }
  const chunks: Buffers[] = [];
  for (const g of groups.values()) {
    const merged = mergeBuffers(g.parts);
    merged.journaledAt = g.journaledAt;
    chunks.push(...splitBuffers(merged, maxSamples));
  }
  return { chunks, staleLines };
}

/** Merge any number of ndjson lines (older formats may miss keys) into one buffer. */
export function mergeBuffers(parts: Partial<Buffers>[]): Buffers {
  const out = emptyBuffers();
  for (const b of parts) for (const k of BUFFER_KEYS) (out[k] as unknown[]).push(...((b[k] as unknown[]) ?? []));
  return out;
}

export const rowCount = (b: Buffers) => BUFFER_KEYS.reduce((n, k) => n + (b[k] as unknown[]).length, 0);

/** The newest observation a buffer carries, or null if it has no timestamps at all. */
export function bufferObservedAt(b: Buffers): Date | null {
  if (b.journaledAt) return new Date(b.journaledAt);
  let max = -Infinity;
  for (const r of b.responses) max = Math.max(max, Date.parse(r.fetchedAt));
  for (const r of b.samples) max = Math.max(max, Date.parse(r.at));
  for (const r of b.titleVersions) max = Math.max(max, Date.parse(r.first_seen));
  return Number.isFinite(max) ? new Date(max) : null;
}

/**
 * Drop the rows that only make sense while the buffer is fresh. A stale buffer's evidence
 * (samples, versions, touch-queue offers) is still true history and is kept; but its
 * channel_rss_state rows would overwrite what live ticks have since written, its videos.title
 * values could revert a newer title, and its re-entries would reopen a 5-minute ladder for a
 * change that is days old. Unknown age is treated as stale.
 */
export function stripStaleControlRows(b: Buffers, now: Date, maxAgeMs = STALE_BUFFER_MS): { buffer: Buffers; stale: boolean } {
  const at = bufferObservedAt(b);
  const stale = !at || now.getTime() - at.getTime() > maxAgeMs;
  if (!stale) return { buffer: b, stale };
  return {
    stale,
    buffer: {
      ...b, channels: [], videoTitles: [], reentries: [],
      // A dropped re-entry is still an observation; keep the stamp.
      titleChecks: [...new Set([...b.titleChecks, ...b.reentries])],
    },
  };
}

/**
 * Split a buffer into chunks of at most `maxSamples` rss_samples and `maxRows` rows of every
 * other kind. The unit of packing is a channel: its feed response, its channel_rss_state row and
 * every video row for the ids its response lists travel together, because saveRssObservations
 * only keeps samples whose (video_id, at) matches a response in the same call. Video rows no
 * response claims form their own single-video units. A unit larger than the caps is never split
 * further (one channel's feed is ~15 videos), so every chunk holds at least one unit.
 * Lossless: concatenating the chunks gives back every row exactly once.
 */
export function splitBuffers(b: Buffers, maxSamples = REPLAY_MAX_SAMPLES, maxRows = REPLAY_MAX_ROWS): Buffers[] {
  const videoUnit = new Map<string, string>();
  const units = new Map<string, Buffers>();
  const unit = (key: string) => { let u = units.get(key); if (!u) { u = emptyBuffers(); units.set(key, u); } return u; };
  for (const r of b.responses) {
    const key = `c:${r.channelId}`;
    unit(key).responses.push(r);
    for (const id of Object.keys(r.views ?? {})) if (!videoUnit.has(id)) videoUnit.set(id, key);
  }
  for (const r of b.channels) unit(`c:${r.channel_id}`).channels.push(r);
  const forVideo = (id: string) => unit(videoUnit.get(id) ?? `v:${id}`);
  for (const r of b.samples) forVideo(r.video_id).samples.push(r);
  for (const id of b.observed) forVideo(id).observed.push(id);
  for (const r of b.titleVersions) forVideo(r.video_id).titleVersions.push(r);
  for (const r of b.videoTitles) forVideo(r.video_id).videoTitles.push(r);
  for (const id of b.reentries) forVideo(id).reentries.push(id);
  for (const id of b.titleChecks) forVideo(id).titleChecks.push(id);
  for (const r of b.descVersions) forVideo(r.video_id).descVersions.push(r);
  for (const r of b.dueNow) forVideo(r.video_id).dueNow.push(r);
  for (const r of b.touchQueue) forVideo(r.ref).touchQueue.push(r);

  const chunks: Buffers[] = [];
  let cur = emptyBuffers();
  const fits = (u: Buffers) => cur.samples.length + u.samples.length <= maxSamples
    && BUFFER_KEYS.every((k) => k === 'samples' || (cur[k] as unknown[]).length + (u[k] as unknown[]).length <= maxRows);
  for (const key of [...units.keys()].sort()) {
    const u = units.get(key)!;
    if (rowCount(cur) && !fits(u)) { chunks.push(cur); cur = emptyBuffers(); }
    for (const k of BUFFER_KEYS) (cur[k] as unknown[]).push(...(u[k] as unknown[]));
  }
  if (rowCount(cur)) chunks.push(cur);
  if (b.journaledAt) for (const c of chunks) c.journaledAt = b.journaledAt;
  return chunks;
}

/** Sidecar attempt counter. `chunkId` identifies the head chunk so a new head chunk resets it. */
export interface ReplayAttempts { attempts: number; chunkId: string; lastError?: string; lastAt?: string }

/** Stable identity for a chunk: its row count plus its first unit's key. */
export function chunkId(b: Buffers): string {
  const first = b.responses[0]?.channelId ?? b.channels[0]?.channel_id ?? b.samples[0]?.video_id
    ?? b.titleChecks[0] ?? b.observed[0] ?? b.touchQueue[0]?.ref ?? '';
  return `${rowCount(b)}:${first}`;
}

export type AttemptDecision = { action: 'retry'; attempts: number } | { action: 'quarantine'; attempts: number };

/** After a head chunk fails: bump the counter (resetting it if the head chunk changed). */
export function afterFailure(prev: ReplayAttempts | null, id: string, max = MAX_REPLAY_ATTEMPTS): AttemptDecision {
  const attempts = (prev && prev.chunkId === id ? prev.attempts : 0) + 1;
  return attempts >= max ? { action: 'quarantine', attempts } : { action: 'retry', attempts };
}

export const quarantineName = (now: Date) => `rss-poll-pending.failed-${now.toISOString().replace(/[:.]/g, '-')}.ndjson`;
