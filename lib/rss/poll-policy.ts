// Channel RSS poll policy (2026-09-03, docs/plans/2026-09-03-two-lane-watcher.md).
// Pure functions + SQL text, no I/O. The free lane decides WHEN something changed;
// the stats lane (launch-track) still decides WHAT happened.
//
// Channel states, keyed on the channel's last upload:
//   active   upload within 60 days   -> poll every 15 min
//   dormant  no upload in 60 days    -> daily safety poll
//   woken    a WebSub push arrived   -> treated as active, polled on the next tick
//
// Conditional requests: we send If-None-Match whenever we have a stored ETag and handle 304.
// MEASURED 2026-09-03: youtube.com/feeds/videos.xml sends NEITHER ETag NOR Last-Modified, so
// in practice every poll is a 200 and "unchanged" is decided by hashing the body (rssBodySha).
// The 304 path stays because the header may come back, and because i.ytimg.com does send one.

export type RssState = 'active' | 'dormant' | 'woken';

export const RSS_POLICY = {
  /** A channel is dormant once its newest upload is older than this. */
  dormantAfterDays: 60,
  /** Cadence per state. */
  activeIntervalSec: 15 * 60,
  /** LaunchAgent starts jitter by seconds. Avoid missing the third tick and waiting 20m. */
  activeDueSlackSec: 60,
  dormantIntervalSec: 24 * 3600,
  /** Cadence for a channel whose WebSub lease is verified and unexpired: the push is the detector. */
  leasedIntervalSec: 24 * 3600,
  /** Back-off on 429/5xx: double, capped. Reset on 200/304. */
  backoffCapSec: 6 * 3600,
  /** Network shape. Raised from 10 to 20 for the 2026-09-03 full-corpus rollout: a full sweep
   * has to fit 4,546 active channels into the 15-minute cadence, i.e. ~1,935 per 5-minute tick.
   * Measured 2026-09-03 after the write path was batched: 400 channels / 57.5 s at concurrency
   * 10 (0.144 s/channel), so 20 keeps a full tick around 2.5 min. */
  concurrency: 20,
  timeoutMs: 10_000,
  /** LaunchAgent tick. The poller itself enforces the per-channel interval. */
  runIntervalSec: 300,
  /** How recent a feed entry must be to count as a new upload worth queueing. */
  newUploadWindowDays: 7,
  /**
   * Absolute ceiling on a tick. Normal capacity is one third of the population so a
   * synchronized cohort spreads over three ticks. This is a guard, not a capacity claim.
   */
  maxPerRun: 6000,
} as const;

const MS = 1000;

/** Age bucket alone: 'active' or 'dormant'. A WebSub push writes 'woken' directly. */
export function stateForLastUpload(
  lastUploadAt: Date | string | null | undefined,
  now: Date = new Date()
): RssState {
  if (!lastUploadAt) return 'dormant';
  const ageMs = now.getTime() - new Date(lastUploadAt).getTime();
  return ageMs < RSS_POLICY.dormantAfterDays * 86_400_000 ? 'active' : 'dormant';
}

/**
 * Base cadence for a state, in seconds.
 *
 * DEMOTED 2026-09-06: WebSub push is the primary upload detector (lib/websub/*), so a channel
 * whose lease is verified and unexpired only needs the daily safety poll — the poll is now a
 * title/description sweep and a coverage net, not the detector. A channel with no lease, or one
 * the hub never verified, keeps the old 15-minute cadence so coverage never drops.
 * 'woken' (a push just arrived) polls at the same cadence as 'active'; the push itself already
 * cleared rss_last_polled, so the next tick picks it up regardless.
 */
export function intervalSecFor(state: RssState, leaseVerified = false): number {
  if (state === 'dormant') return RSS_POLICY.dormantIntervalSec;
  return leaseVerified ? RSS_POLICY.leasedIntervalSec : RSS_POLICY.activeIntervalSec;
}

/**
 * Feed view counts are no longer stored as data. rss_samples was a second, unsanctioned
 * readings source next to the Data API's view_samples; since 2026-09-06 the API is the only
 * source of view readings and this write is off unless RSS_SAMPLES=1 turns it back on for a
 * one-off investigation.
 */
export function rssSamplesEnabled(): boolean {
  return process.env.RSS_SAMPLES === '1';
}

export interface ChannelPollState {
  rss_state: RssState;
  rss_last_polled: Date | string | null;
  rss_backoff_until?: Date | string | null;
  /** Back-off override written after a 429/5xx; null once the channel recovers. */
  rss_interval_sec?: number | null;
  /** A verified, unexpired WebSub lease demotes this channel to the daily cadence. */
  lease_verified?: boolean;
}

/** Is this channel allowed to be polled right now? */
export function isDue(c: ChannelPollState, now: Date = new Date()): boolean {
  if (c.rss_backoff_until && new Date(c.rss_backoff_until).getTime() > now.getTime()) return false;
  if (!c.rss_last_polled) return true; // never polled
  const interval = c.rss_interval_sec ?? intervalSecFor(c.rss_state, c.lease_verified);
  const slack = c.rss_state !== 'dormant' && c.rss_interval_sec == null && !c.lease_verified
    ? RSS_POLICY.activeDueSlackSec : 0;
  return now.getTime() - new Date(c.rss_last_polled).getTime() >= (interval - slack) * MS;
}

/**
 * Next interval after a response. 200/304 resets to the state cadence; 429 and 5xx double the
 * current interval up to the cap. Returns seconds and the instant to hold off until.
 */
export function backoffAfter(
  status: number,
  state: RssState,
  currentIntervalSec: number | null | undefined,
  now: Date = new Date()
): { intervalSec: number | null; backoffUntil: Date | null } {
  if (status === 200 || status === 304) return { intervalSec: null, backoffUntil: null };
  if (status !== 429 && status < 500) {
    // 3xx/4xx that is not rate limiting (404 on a dead channel): back off one full cycle,
    // do not escalate — escalating would hide a channel that simply moved.
    const base = intervalSecFor(state);
    return { intervalSec: base, backoffUntil: new Date(now.getTime() + base * MS) };
  }
  const base = currentIntervalSec ?? intervalSecFor(state);
  const next = Math.min(base * 2, RSS_POLICY.backoffCapSec);
  return { intervalSec: next, backoffUntil: new Date(now.getTime() + next * MS) };
}

/** Spread the population over the three ticks in each active polling interval.
 * Oldest-polled-first selection preserves 15m coverage while avoiding a synchronized
 * 5,000-feed snapshot that consumed nearly the full 285s worker budget under shared IO.
 * Dormant channels retain their longer interval; including them in the capacity calculation
 * leaves headroom for due dormant feeds and newly subscribed channels.
 */
export function perRunCap(totalChannels: number): number {
  const ticks = Math.max(1, Math.floor(RSS_POLICY.activeIntervalSec / RSS_POLICY.runIntervalSec));
  return Math.min(RSS_POLICY.maxPerRun, Math.max(1, Math.ceil(totalChannels / ticks)));
}

/**
 * Only genuinely NEW uploads belong in the touch queue. A channel's last-15 feed also lists
 * older catalogue entries we never ingested, and enqueueing those is not discovery — it is an
 * unbudgeted backfill. Measured 2026-09-03 on the first full-corpus pass: of 50 sampled queued
 * ids, 47 were <=180s (Shorts or clips the corpus deliberately excludes) and 29 were over a
 * month old. Each one still costs a videos.list slot in the drainer before being thrown away.
 *
 * Same evidence window as the title rule: an upload published inside it is news; anything older
 * that we do not already have is a backfill question, not the watcher's job.
 */
export function isNewUpload(
  published: string | null | undefined,
  now: Date = new Date(),
  windowDays: number = RSS_POLICY.newUploadWindowDays
): boolean {
  if (!published) return false;
  return now.getTime() - new Date(published).getTime() < windowDays * 86_400_000;
}

/**
 * Should this reading be stored?
 *
 * REPLACES the old 30-day age gate (isSampleWorthy). That gate threw away every free reading
 * for a video older than a month — exactly the back-catalogue readings the long-tail fit has no
 * data for — while still writing ~67K rows/hour (~200 MB/day) for the young ones, most of them
 * a repeat of the number stored 15 minutes earlier.
 *
 * Change-based instead: store a reading when it actually says something.
 *   - no reading on file      -> store (first point of the trace)
 *   - the count moved         -> store (a real measurement)
 *   - nothing moved for 24h   -> store (a heartbeat, so a flat curve is still evidence
 *                                       of flatness rather than a gap)
 * A young video keeps its dense trace (its counts move every tick); a dead 8-year-old costs one
 * row a day instead of 96.
 */
export const SAMPLE_HEARTBEAT_MS = 24 * 3_600_000;

export interface PrevSample {
  views: number | null;
  at: Date | string;
}

export function shouldStoreSample(
  prev: PrevSample | null | undefined,
  views: number | null | undefined,
  now: Date = new Date()
): boolean {
  if (views == null || !Number.isFinite(Number(views)) || Number(views) < 0) return false;
  if (!prev) return true;
  if (prev.views == null || Number(prev.views) !== Number(views)) return true;
  const age = now.getTime() - new Date(prev.at).getTime();
  return !(age < SAMPLE_HEARTBEAT_MS); // NaN-safe: an unparseable stamp stores
}

/**
 * What to do with a feed entry whose video id is NOT in `videos` yet.
 *
 * Before 2026-09-04 the poller did `continue` here, so the launch-minute view count of a brand
 * new upload was thrown away and the first stored reading came from whenever the drainer got
 * round to importing it. `rss_samples` has NO foreign key to `videos` — verified on the live
 * database 2026-09-04, its only constraint is `PRIMARY KEY (video_id, at)` — so the reading can
 * be written straight away and simply predates the video row. No holding table is needed.
 *
 * Only genuinely new uploads are queued (isNewUpload); an old catalogue entry we never ingested
 * is a backfill question. The reading is kept in both cases: it is free, and a back-catalogue
 * trace is exactly the data the long-tail fit lacks.
 */
export function unknownEntryPlan(
  entry: { published?: string | null; views?: number | null },
  now: Date = new Date(),
  previous?: PrevSample | null,
): { queue: boolean; sample: boolean } {
  return {
    queue: isNewUpload(entry.published, now),
    sample: shouldStoreSample(previous, entry.views, now),
  };
}

/**
 * The last stored reading per video, for the ids this tick's feeds mentioned. ONE set-based
 * query in the poller's SNAPSHOT phase — never a per-channel query inside the fetch loop
 * (the shape that cost ~0.40 s/channel before the 2026-09-03 rewrite). $1 = video ids.
 */
export const LAST_SAMPLES_SQL = `select latest.video_id, latest.views, latest.at
  from unnest($1::text[]) as requested(video_id)
  cross join lateral (
    select s.video_id, s.views, s.at from rss_samples s
    where s.video_id = requested.video_id order by s.at desc limit 1
  ) latest`;

/** Byte-change telemetry only. Even unchanged bodies must reach sample heartbeat/title checks. */
export function hasFeedBodyChanged(
  storedBodySha: string | null | undefined,
  bodySha: string
): boolean {
  return storedBodySha !== bodySha;
}

// ---------- feed parsing ----------

export interface RssEntry {
  video_id: string;
  channel_id: string | null;
  title: string;
  description: string | null;
  published: string | null;
  updated: string | null;
  views: number | null;
  likes: number | null;
}

const tag = (block: string, name: string): string | null => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? m[1] : null;
};

/** Parse a channel feed into its (up to 15) entries. Tolerant: a malformed entry is skipped. */
export function parseRssEntries(xml: string): RssEntry[] {
  const out: RssEntry[] = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const id = /<yt:videoId>([A-Za-z0-9_-]{6,20})<\/yt:videoId>/.exec(b)?.[1];
    if (!id) continue;
    const title = tag(b, 'title');
    if (title == null) continue;
    const views = /<media:statistics[^>]*\bviews="(\d+)"/.exec(b)?.[1];
    const likes = /<media:starRating[^>]*\bcount="(\d+)"/.exec(b)?.[1];
    out.push({
      video_id: id,
      channel_id: /<yt:channelId>(UC[A-Za-z0-9_-]{22})<\/yt:channelId>/.exec(b)?.[1] ?? null,
      title: decodeEntities(title.trim()),
      description: (() => {
        const d = /<media:description>([\s\S]*?)<\/media:description>/.exec(b)?.[1];
        return d == null ? null : decodeEntities(d);
      })(),
      published: tag(b, 'published'),
      updated: tag(b, 'updated'),
      views: views ? parseInt(views, 10) : null,
      likes: likes ? parseInt(likes, 10) : null,
    });
  }
  return out;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&amp;/g, '&'); // last: an entity encoded twice decodes one level, not two
}

/** The feed says the video changed since we last looked. */
export function isUpdatedSince(
  entryUpdated: string | null | undefined,
  knownUpdated: Date | string | null | undefined
): boolean {
  if (!entryUpdated) return false;
  if (!knownUpdated) return true;
  return new Date(entryUpdated).getTime() > new Date(knownUpdated).getTime();
}

// ---------- SQL ----------

/**
 * Refresh last_upload_at / rss_state and create missing rows. Two shapes on purpose:
 *
 * SEED_SUBSET_SQL drives off watch_subset and takes max(published_at) per channel through a
 * LATERAL on idx_videos_channel_published — 52 index-only probes, 7 ms measured.
 * The obvious `group by channel_id where exists (subset)` form instead scans the whole
 * channel/published index (872K rows filtered, 98K blocks read, 56 s measured 2026-09-03).
 * This DB has had IO incidents; never use that shape.
 *
 * SEED_ALL_SQL enumerates channel keys with a loose recursive index scan, then probes the latest
 * publication once per channel. A GROUP BY walked roughly one million index entries and took
 * 91s under shared IO; this shape retained all 6,422 video channels in 24.3s (2026-09-04).
 */
const SEED_UPSERT_TAIL = `on conflict (channel_id) do update
      set last_upload_at = excluded.last_upload_at,
          -- never demote a channel a WebSub push just woke; the poll itself clears 'woken'
          rss_state = case when channel_rss_state.rss_state = 'woken' then 'woken' else excluded.rss_state end,
          updated_at = now()
    where channel_rss_state.last_upload_at is distinct from excluded.last_upload_at
       or (channel_rss_state.rss_state is distinct from 'woken'
           and channel_rss_state.rss_state is distinct from excluded.rss_state)`;

const seedState = (col: string) =>
  `case when ${col} > now() - interval '${RSS_POLICY.dormantAfterDays} days' then 'active' else 'dormant' end`;

export const SEED_SUBSET_SQL = `insert into channel_rss_state (channel_id, last_upload_at, rss_state)
   select w.channel_id, m.last_upload_at, ${seedState('m.last_upload_at')}
     from watch_subset w
     cross join lateral (
       select max(v.published_at) as last_upload_at from videos v where v.channel_id = w.channel_id
     ) m
   ${SEED_UPSERT_TAIL}`;

export const SEED_ALL_SQL = `with recursive channels(channel_id) as (
     select min(channel_id) from videos where channel_id is not null
     union all
     select (select min(v.channel_id) from videos v where v.channel_id > channels.channel_id)
       from channels where channel_id is not null
   )
   insert into channel_rss_state (channel_id, last_upload_at, rss_state)
   select c.channel_id, latest.published_at, ${seedState('latest.published_at')}
     from channels c
     left join lateral (
       select v.published_at from videos v
        where v.channel_id = c.channel_id and v.published_at is not null
        order by v.published_at desc limit 1
     ) latest on true
    where c.channel_id is not null
   ${SEED_UPSERT_TAIL}`;

/**
 * Channels due for a poll, oldest first so the stagger is even.
 * $1 = subset only, $2 = limit.
 */
export const DUE_CHANNELS_SQL = `select c.channel_id, c.rss_state, c.rss_etag, c.rss_body_sha, c.rss_interval_sec
     from channel_rss_state c
     left join websub_leases l
       on l.channel_id = c.channel_id and l.last_verified_at is not null and l.lease_expires_at > now()
    where (not $1::boolean or exists (select 1 from watch_subset w where w.channel_id = c.channel_id))
      and (c.rss_backoff_until is null or c.rss_backoff_until <= now())
      and (c.rss_last_polled is null
           or c.rss_last_polled < now() - (coalesce(c.rss_interval_sec,
                case when c.rss_state = 'dormant' then ${RSS_POLICY.dormantIntervalSec}
                     when l.channel_id is not null then ${RSS_POLICY.leasedIntervalSec}
                     else ${RSS_POLICY.activeIntervalSec} end) * interval '1 second')
             + case when c.rss_state <> 'dormant' and c.rss_interval_sec is null and l.channel_id is null
                    then interval '${RSS_POLICY.activeDueSlackSec} seconds' else interval '0 seconds' end)
    order by c.rss_last_polled nulls first
    limit $2`;

/** --dry counts, one grouped pass. $1 = subset only. */
export const STATE_COUNTS_SQL = `select c.rss_state,
          count(*)::int as total,
          count(l.channel_id)::int as leased,
          count(*) filter (where
            (c.rss_backoff_until is null or c.rss_backoff_until <= now())
            and (c.rss_last_polled is null
                 or c.rss_last_polled < now() - (coalesce(c.rss_interval_sec,
                      case when c.rss_state = 'dormant' then ${RSS_POLICY.dormantIntervalSec}
                           when l.channel_id is not null then ${RSS_POLICY.leasedIntervalSec}
                           else ${RSS_POLICY.activeIntervalSec} end) * interval '1 second')
                   + case when c.rss_state <> 'dormant' and c.rss_interval_sec is null and l.channel_id is null
                          then interval '${RSS_POLICY.activeDueSlackSec} seconds' else interval '0 seconds' end))::int as due
     from channel_rss_state c
     left join websub_leases l
       on l.channel_id = c.channel_id and l.last_verified_at is not null and l.lease_expires_at > now()
    where (not $1::boolean or exists (select 1 from watch_subset w where w.channel_id = c.channel_id))
    group by 1`;

/** Fetched-but-undiffed feeds remain due, including an entirely aborted snapshot phase. */
export function completedChannelRows<T extends { channel_id: string }>(rows: T[], fetchedIds: ReadonlySet<string>, diffedIds: ReadonlySet<string>): T[] {
  return rows.filter(r => !fetchedIds.has(r.channel_id) || diffedIds.has(r.channel_id));
}
