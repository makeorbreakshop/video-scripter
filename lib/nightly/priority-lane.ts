// The tracked-upload priority lane for the touch-queue drainer.
//
// WHY THIS EXISTS (2026-09-03/04, BPS.space PpwewkOCFuE):
// The drainer read `touch_queue ... order by id limit 1000` — strict FIFO behind ~17K
// back-catalogue discovery rows — and, before reading the queue at all, exited on
// DISCOVERY_DAILY_CAP. On 2026-09-02 and 2026-09-03 the discovery ledger hit that 2,000-unit
// cap (measured: 2,000 and 2,256 units), so every 5-minute run exited immediately. BPS.space
// published at 14:14 ET, the poller queued the id at 14:17 ET, and nothing looked at that row
// until 01:22 ET the next day — by which time another path had imported the video at 20:27 ET.
// Six hours of launch curve, gone, on a channel we deliberately watch.
//
// The rule this module encodes: a new upload on a channel we already watch is not discovery.
// Discovery is speculative browsing and deserves a daily cap. A tracked-channel upload is the
// product; it never waits behind a speculative budget and it never queues behind a backfill.
//
// WHICH CHANNELS COUNT ("covered"): the union of the two registries the watcher itself drives
// off, so the lane covers exactly the channels something is already watching —
//   - channel_rss_state — every channel scripts/rss-poll.ts polls. Seeded by SEED_ALL_SQL from
//     `select channel_id from videos group by channel_id`, i.e. any channel with a video in the
//     corpus. This is rss-poll's own answer to "whose feed do I read?".
//   - competitor_youtube_channels + discovered_channels — exactly the two lists
//     scripts/websub-subscribe.ts subscribes.
// NOT channel_tracking: that is the 22-row dense/backfill lane registry, a different question.
// The set is deliberately the *watcher's* definition, not enrollment-core's four-registry
// isTracked(), because the lane's job is to keep up with feeds we already fetch.

export const PRIORITY_LANE = {
  /** videos.list ids per run. 200 ids = 4 units; 288 runs/day = 1,152 units worst case. */
  maxIdsPerRun: 200,
  /** videos.list batches 50 ids per unit. */
  idsPerCall: 50,
  /** Its own ledger category, so it is never charged against — or capped by — 'discovery'. */
  quotaCategory: 'tracked-upload',
  /** How many pending feed/websub rows to consider per run, newest-seen first. */
  scanLimit: 500,
} as const;

export interface QueueRow {
  id: number;
  kind: string;
  ref: string;
  mode: string;
  source_url: string | null;
  seen_at?: string | Date | null;
}

/** The modes that mean "a feed said this video exists", as opposed to a user click. */
export const PRIORITY_MODES = ['feed', 'websub'] as const;

/**
 * The channel a queue row's source_url names, when it names one.
 * scripts/rss-poll.ts writes `feed:/rss/<UCxxx>`; the WebSub callback writes `websub:<UCxxx>`;
 * the browser extension writes `feed:/`, `feed:/watch`, `feed:/results`, `feed:/@handle/` — a
 * page path with no channel in it, which is why a source_url match alone cannot gate the lane.
 */
export function channelFromSourceUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^(?:feed:\/rss\/|websub:)(UC[A-Za-z0-9_-]{22})$/.exec(url.trim());
  return m ? m[1] : null;
}

const time = (v: string | Date | null | undefined): number =>
  v == null ? 0 : new Date(v).getTime();

export interface PrioritySelection {
  /** Rows to fetch this run, in the order to fetch them. */
  priority: QueueRow[];
  /** Rows that qualify but did not fit this run's budget; they stay pending. */
  overflow: QueueRow[];
}

/**
 * Which pending rows the priority lane takes this run.
 *
 * Rank 0: source_url names a covered channel — certain to be a tracked-channel upload.
 * Rank 1: source_url names no channel at all (extension sightings, the shape of the row that
 *         lost BPS.space). The channel is only knowable after videos.list, so these are
 *         admitted on spec and filtered afterwards by isPriorityImport().
 * Excluded: source_url names a channel we do NOT cover — that is discovery, and it keeps
 *         waiting on the discovery budget exactly as before.
 *
 * Within a rank, newest sighting first. Ordering by publication date is impossible before the
 * fetch (the queue stores no published_at); orderByPublishedDesc() applies that ordering to the
 * fetched items, which is the order the imports actually happen in.
 */
export function selectPriorityRows(
  rows: QueueRow[],
  covered: Set<string>,
  knownVideos: Set<string> = new Set(),
  budget: number = PRIORITY_LANE.maxIdsPerRun,
): PrioritySelection {
  const modes = new Set<string>(PRIORITY_MODES);
  const ranked: { row: QueueRow; rank: number }[] = [];
  for (const row of rows) {
    if (row.kind !== 'video') continue;
    if (!modes.has(row.mode)) continue;
    if (knownVideos.has(row.ref)) continue;
    const ch = channelFromSourceUrl(row.source_url);
    if (ch == null) ranked.push({ row, rank: 1 });
    else if (covered.has(ch)) ranked.push({ row, rank: 0 });
    // else: a named, uncovered channel — discovery's problem, not this lane's.
  }
  ranked.sort((a, b) => a.rank - b.rank || time(b.row.seen_at) - time(a.row.seen_at) || b.row.id - a.row.id);
  const ordered = ranked.map((r) => r.row);
  // Dedupe on ref: the same id can be queued twice under different modes.
  const seen = new Set<string>();
  const unique = ordered.filter((r) => (seen.has(r.ref) ? false : (seen.add(r.ref), true)));
  return { priority: unique.slice(0, budget), overflow: unique.slice(budget) };
}

/** Newest published first — the order the lane imports in, so today's upload never waits. */
export function orderByPublishedDesc<T extends { snippet?: { publishedAt?: string | null } | null }>(items: T[]): T[] {
  return [...items].sort((a, z) => time(z.snippet?.publishedAt) - time(a.snippet?.publishedAt));
}

/** After the fetch: is this actually a tracked-channel upload, or was it admitted on spec? */
export function isPriorityImport(channelId: string | null | undefined, covered: Set<string>): boolean {
  return !!channelId && covered.has(channelId);
}

/** videos.list units for an id count: one unit per 50 ids. */
export function quotaUnits(idCount: number, per: number = PRIORITY_LANE.idsPerCall): number {
  return idCount <= 0 ? 0 : Math.ceil(idCount / per);
}
