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
  dormantIntervalSec: 24 * 3600,
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
  /** Hard ceiling on channels touched in one run, whatever the stagger says. Set above the
   * corpus's own stagger number (ceil(5,803 / 3) = 1,935) so the 15-minute active cadence is
   * actually achieved rather than silently stretched — at 600 it was a ~38-minute cadence. */
  maxPerRun: 2500,
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

/** Base cadence for a state, in seconds. 'woken' polls as fast as 'active'. */
export function intervalSecFor(state: RssState): number {
  return state === 'dormant' ? RSS_POLICY.dormantIntervalSec : RSS_POLICY.activeIntervalSec;
}

export interface ChannelPollState {
  rss_state: RssState;
  rss_last_polled: Date | string | null;
  rss_backoff_until?: Date | string | null;
  /** Back-off override written after a 429/5xx; null once the channel recovers. */
  rss_interval_sec?: number | null;
}

/** Is this channel allowed to be polled right now? */
export function isDue(c: ChannelPollState, now: Date = new Date()): boolean {
  if (c.rss_backoff_until && new Date(c.rss_backoff_until).getTime() > now.getTime()) return false;
  if (!c.rss_last_polled) return true; // never polled
  const interval = c.rss_interval_sec ?? intervalSecFor(c.rss_state);
  return now.getTime() - new Date(c.rss_last_polled).getTime() >= interval * MS;
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

/**
 * Stagger: how many channels one run may take so the whole due population is spread evenly
 * across the per-channel interval instead of arriving as a burst every 15 minutes.
 * With 52 subset channels at 15 min and a 5-min tick this is ceil(52/3) = 18 per run.
 */
export function perRunCap(
  totalChannels: number,
  intervalSec: number = RSS_POLICY.activeIntervalSec,
  runIntervalSec: number = RSS_POLICY.runIntervalSec
): number {
  const slots = Math.max(1, Math.floor(intervalSec / runIntervalSec));
  return Math.min(RSS_POLICY.maxPerRun, Math.max(1, Math.ceil(totalChannels / slots)));
}

/**
 * What a 200 response is worth. The feed carries no ETag, so the body hash is our only
 * "nothing changed" signal — and when it says nothing changed, nothing at all is written for
 * the channel's videos: no rss_samples, no title/description diffs, no due-now marks. Only
 * rss_last_polled moves. A sample row for a byte-identical feed would just duplicate the
 * previous row's counts, so it is noise in the dense trace, not data.
 *
 * Any change to the body — including the view/like counts embedded in media:statistics —
 * makes the poll a full one, so real traces never lose a point.
 */
export function shouldProcessEntries(
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
 * SEED_ALL_SQL is the full-corpus form for after the subset test; it is the expensive one and
 * the poller only runs it on the first LaunchAgent slot of the hour.
 */
const SEED_UPSERT_TAIL = `on conflict (channel_id) do update
      set last_upload_at = excluded.last_upload_at,
          -- never demote a channel a WebSub push just woke; the poll itself clears 'woken'
          rss_state = case when channel_rss_state.rss_state = 'woken' then 'woken' else excluded.rss_state end,
          updated_at = now()`;

const seedState = (col: string) =>
  `case when ${col} > now() - interval '${RSS_POLICY.dormantAfterDays} days' then 'active' else 'dormant' end`;

export const SEED_SUBSET_SQL = `insert into channel_rss_state (channel_id, last_upload_at, rss_state)
   select w.channel_id, m.last_upload_at, ${seedState('m.last_upload_at')}
     from watch_subset w
     cross join lateral (
       select max(v.published_at) as last_upload_at from videos v where v.channel_id = w.channel_id
     ) m
   ${SEED_UPSERT_TAIL}`;

export const SEED_ALL_SQL = `insert into channel_rss_state (channel_id, last_upload_at, rss_state)
   select v.channel_id, max(v.published_at), ${seedState('max(v.published_at)')}
     from videos v
    where v.channel_id is not null
    group by v.channel_id
   ${SEED_UPSERT_TAIL}`;

/**
 * Channels due for a poll, oldest first so the stagger is even.
 * $1 = subset only, $2 = limit.
 */
export const DUE_CHANNELS_SQL = `select c.channel_id, c.rss_state, c.rss_etag, c.rss_body_sha, c.rss_interval_sec
     from channel_rss_state c
    where (not $1::boolean or exists (select 1 from watch_subset w where w.channel_id = c.channel_id))
      and (c.rss_backoff_until is null or c.rss_backoff_until <= now())
      and (c.rss_last_polled is null
           or c.rss_last_polled < now() - (coalesce(c.rss_interval_sec,
                case when c.rss_state = 'dormant' then ${RSS_POLICY.dormantIntervalSec}
                     else ${RSS_POLICY.activeIntervalSec} end) * interval '1 second'))
    order by c.rss_last_polled nulls first
    limit $2`;

/** --dry counts, one grouped pass. $1 = subset only. */
export const STATE_COUNTS_SQL = `select c.rss_state,
          count(*)::int as total,
          count(*) filter (where
            (c.rss_backoff_until is null or c.rss_backoff_until <= now())
            and (c.rss_last_polled is null
                 or c.rss_last_polled < now() - (coalesce(c.rss_interval_sec,
                      case when c.rss_state = 'dormant' then ${RSS_POLICY.dormantIntervalSec}
                           else ${RSS_POLICY.activeIntervalSec} end) * interval '1 second')))::int as due
     from channel_rss_state c
    where (not $1::boolean or exists (select 1 from watch_subset w where w.channel_id = c.channel_id))
    group by 1`;
