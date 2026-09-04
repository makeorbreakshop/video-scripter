// ChannelSmith channel operations: search the corpus, resolve arbitrary user
// input to a YouTube channel, and track/untrack it for a user.
//
// Direct Postgres only (lib/admin/db.ts) — never supabase-js (2026-08-31
// org-wide egress incident). Every YouTube API unit is written to quota_ledger.
import { channelMeta } from './channel-meta';
import { q, one } from '../admin/db';
import { chunk, clampCount, parseRssVideoIds } from '../nightly/tracking-core';
import { canWatchMoreClosely } from './plans';
import { planUsage } from './users';
import {
  ChannelRef, CHANNEL_ID_RE, bareHandle, parseChannelInput, uploadsPlaylistId,
} from './channels-core';
import { metaFromListItem, saveChannelMeta } from './channel-meta';
import { searchTerms, normalizeName } from './channel-search';
import { classifyForInsert, skipForInsert } from '../ingest/classify';
import { firstSampleWrite, broadcastMetadataWrite } from '../ingest/first-sample';
import { refreshChannelStats } from './channel-stats';
import { revalidateChannel } from './revalidate';

const YT = 'https://www.googleapis.com/youtube/v3';

function apiKey(): string {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error('YOUTUBE_API_KEY is not set');
  return k;
}

/** Record YouTube API units. Never throws — quota logging must not fail a request. */
export async function logQuota(category: string, units: number): Promise<void> {
  if (units <= 0) return;
  await q(`insert into quota_ledger (category, units) values ($1, $2)`, [category, units]).catch(() => {});
  await q(
    `insert into youtube_quota_usage (date, quota_used) values (current_date, $1)
     on conflict (date) do update set quota_used = youtube_quota_usage.quota_used + $1`,
    [units]
  ).catch(() => {});
}

export async function quotaSpentToday(category: string): Promise<number> {
  const row = await one<{ spent: string }>(
    `select coalesce(sum(units),0)::int as spent from quota_ledger where date = current_date and category = $1`,
    [category]
  );
  return parseInt(String(row?.spent ?? 0), 10);
}

// ---------------------------------------------------------------- search ----

export interface ChannelSearchResult {
  channel_id: string;
  name: string;
  video_count: number;
  tracked_lane: 'corpus' | 'user' | null;
  avatar_url: string | null;
  handle: string | null;
  subscriber_count?: number | null;
}

export interface ChannelSearchFilters {
  minSubscribers?: number | null;
  maxSubscribers?: number | null;
  lane?: 'user' | 'corpus' | null;
  niche?: string | null;
  excludeIds?: string[];
}

const DIRECTORY_COLS = `channel_id, name, handle, avatar_url, subscriber_count::bigint as subscriber_count, video_count::int as video_count, tracked_lane`;

/**
 * Search the channels we already know about, from the channel_directory view
 * (sql/channel-directory.sql). Ranked: exact handle, then name/handle prefix,
 * then the squashed name prefix ("iliketomakestuff" -> "I Like To Make Stuff"),
 * then substring, then trigram similarity for typos; ties break on video count.
 * Every WHERE arm is an indexable operator (%, <%, like, ilike) so the GIN trigram
 * indexes serve it — EXPLAIN showed a seq scan at 80ms with word_similarity() as a
 * function call. No YouTube quota.
 */
export async function searchTracked(query: string, limit = 20, filters: ChannelSearchFilters = {}): Promise<ChannelSearchResult[]> {
  const t = searchTerms(query);
  if (!t) return [];
  const cap = Math.min(Math.max(limit, 1), 50);
  const hasFilters = filters.minSubscribers != null || filters.maxSubscribers != null || filters.lane != null
    || !!filters.niche || !!filters.excludeIds?.length;
  if (hasFilters) {
    return q<ChannelSearchResult>(
      `select d.channel_id, d.name, d.handle, d.avatar_url, d.video_count::int as video_count,
              d.tracked_lane, cm.subscriber_count
         from channel_directory d
         left join channel_meta cm on cm.channel_id = d.channel_id
        where (d.handle = $3
           or d.name ilike '%' || $1 || '%'
           or d.norm like $2 || '%'
           or d.norm % $2
           or d.name % $1
           or $1 <% d.name)
          and ($5::bigint is null or cm.subscriber_count >= $5)
          and ($6::bigint is null or cm.subscriber_count <= $6)
          and ($7::text is null or coalesce(d.tracked_lane, 'corpus') = $7)
          and ($8::text is null or exists (
            select 1 from videos v where v.channel_id = d.channel_id and v.topic_niche = $8 limit 1
          ))
          and not (d.channel_id = any($9::text[]))
        order by
          (d.handle = $3) desc,
          (lower(d.name) like $1 || '%' or d.handle like $1 || '%') desc,
          (d.norm like $2 || '%') desc,
          greatest(similarity(d.norm, $2), similarity(d.name, $1), word_similarity($1, d.name)) desc,
          d.video_count desc,
          d.name asc
        limit $4`,
      [t.text, t.norm, t.handle, cap, filters.minSubscribers ?? null, filters.maxSubscribers ?? null,
        filters.lane ?? null, filters.niche ?? null, filters.excludeIds ?? []],
    );
  }
  return q<ChannelSearchResult>(
    `select ${DIRECTORY_COLS}
       from channel_directory
      where handle = $3
         or name ilike '%' || $1 || '%'
         or norm like $2 || '%'
         or norm % $2
         or name % $1
         or $1 <% name
      order by
        (handle = $3) desc,
        (lower(name) like $1 || '%' or handle like $1 || '%') desc,
        (norm like $2 || '%') desc,
        greatest(similarity(norm, $2), similarity(name, $1), word_similarity($1, name)) desc,
        video_count desc,
        name asc
      limit $4`,
    [t.text, t.norm, t.handle, cap]
  );
}

/** One channel by exact handle (no '@', any case), or null. */
export async function findByHandle(handle: string): Promise<ChannelSearchResult | null> {
  const h = bareHandle(handle).toLowerCase();
  if (!h) return null;
  return one<ChannelSearchResult>(
    `select ${DIRECTORY_COLS} from channel_directory where handle = $1 limit 1`, [h]
  );
}

/** Rebuild every directory row from the registries (one set-based upsert). Never throws. */
export async function refreshChannelDirectory(): Promise<number> {
  const row = await one<{ n: number }>(`select refresh_channel_directory() as n`).catch((e) => {
    console.error('refreshChannelDirectory:', e.message);
    return null;
  });
  return row?.n ?? 0;
}

/** Put one freshly resolved channel into the directory so it is searchable immediately. */
export async function upsertDirectoryRow(ch: ResolvedChannel): Promise<void> {
  const name = ch.name || ch.channel_id;
  await q(
    `insert into channel_directory (channel_id, name, norm, handle, avatar_url, subscriber_count, video_count, tracked_lane)
     values ($1, $2, $3, $4, $5, $6, 0, 'user')
     on conflict (channel_id) do update
       set name = excluded.name, norm = excluded.norm,
           handle = coalesce(excluded.handle, channel_directory.handle),
           avatar_url = coalesce(excluded.avatar_url, channel_directory.avatar_url),
           subscriber_count = coalesce(excluded.subscriber_count, channel_directory.subscriber_count),
           tracked_lane = 'user', refreshed_at = now()`,
    [ch.channel_id, name, normalizeName(name), ch.handle ? bareHandle(ch.handle).toLowerCase() : null, ch.thumbnail_url, ch.subscriber_count]
  ).catch((e) => console.error('upsertDirectoryRow:', e.message));
}

// --------------------------------------------------------------- resolve ----

export interface ResolvedChannel {
  channel_id: string;
  name: string;
  handle: string | null;
  thumbnail_url: string | null;
  subscriber_count: number | null;
  video_count: number | null;
  uploads_playlist_id: string | null;
  units: number;      // YouTube units spent resolving
  known: boolean;     // already in our corpus/registries
}

async function ytJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** channels.list — 1 unit. */
async function fetchChannel(param: 'id' | 'forHandle', value: string) {
  const d = await ytJson(
    `${YT}/channels?part=snippet,statistics,contentDetails&${param}=${encodeURIComponent(value)}&key=${apiKey()}`
  );
  const item = d.items?.[0] || null;
  // The response is already paid for; caching its identity here is what feeds the avatars.
  if (item) await saveChannelMeta([metaFromListItem(item)]);
  return item;
}

/** videos.list for a video id -> its channel id. 1 unit. */
async function channelIdForVideo(videoId: string): Promise<string | null> {
  const d = await ytJson(`${YT}/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${apiKey()}`);
  return d.items?.[0]?.snippet?.channelId || null;
}

export async function isKnownChannel(channelId: string): Promise<boolean> {
  const row = await one<{ known: boolean }>(
    `select (exists (select 1 from videos where channel_id = $1 limit 1)
          or exists (select 1 from discovered_channels where channel_id = $1)
          or exists (select 1 from channels where channel_id = $1)) as known`,
    [channelId]
  );
  return !!row?.known;
}

/**
 * Resolve a parsed reference to a real channel. 'search' refs are not
 * resolvable here — the caller should show searchTracked() results instead.
 * Units are logged to quota_ledger under 'app-resolve'.
 */
export async function resolveChannel(ref: ChannelRef): Promise<ResolvedChannel | null> {
  let units = 0;
  let item: any = null;
  try {
    if (ref.kind === 'id') {
      units += 1;
      item = await fetchChannel('id', ref.value);
    } else if (ref.kind === 'handle') {
      units += 1;
      item = await fetchChannel('forHandle', bareHandle(ref.value));
    } else if (ref.kind === 'video') {
      units += 1;
      const chId = await channelIdForVideo(ref.value);
      if (chId) {
        units += 1;
        item = await fetchChannel('id', chId);
      }
    } else {
      return null; // 'search'
    }
  } finally {
    await logQuota('app-resolve', units);
  }
  if (!item) return null;

  const sn = item.snippet || {};
  const st = item.statistics || {};
  return {
    channel_id: item.id,
    name: sn.title || item.id,
    handle: sn.customUrl || null,
    thumbnail_url: sn.thumbnails?.high?.url || sn.thumbnails?.default?.url || null,
    subscriber_count: st.subscriberCount != null ? clampCount(parseInt(st.subscriberCount, 10)) : null,
    video_count: st.videoCount != null ? clampCount(parseInt(st.videoCount, 10)) : null,
    uploads_playlist_id: item.contentDetails?.relatedPlaylists?.uploads || uploadsPlaylistId(item.id),
    units,
    known: await isKnownChannel(item.id),
  };
}

/**
 * Resolve many channel ids at once. channels.list takes up to 50 ids for the same 1 unit as
 * one, so a 474-channel subscription import costs 10 calls here instead of 474 — the single
 * biggest reason the import no longer needs a cap to be safe. Ids YouTube does not answer
 * for are simply absent from the map.
 */
export async function resolveChannelsByIds(channelIds: string[]): Promise<Map<string, ResolvedChannel>> {
  const ids = Array.from(new Set((channelIds || []).filter((id) => CHANNEL_ID_RE.test(id))));
  const out = new Map<string, ResolvedChannel>();
  if (!ids.length) return out;

  let units = 0;
  const items: any[] = [];
  try {
    for (const group of chunk(ids, 50)) {
      units += 1;
      const d = await ytJson(
        `${YT}/channels?part=snippet,statistics,contentDetails&id=${group.join(',')}&maxResults=50&key=${apiKey()}`
      );
      for (const it of d.items || []) items.push(it);
    }
  } finally {
    await logQuota('app-resolve', units);
  }
  // One write for every identity the calls paid for: this is what feeds the avatars, and
  // what keeps trackChannel from spending a second unit per channel.
  if (items.length) await saveChannelMeta(items.map(metaFromListItem));

  for (const item of items) {
    const sn = item.snippet || {};
    const st = item.statistics || {};
    out.set(item.id, {
      channel_id: item.id,
      name: sn.title || item.id,
      handle: sn.customUrl || null,
      thumbnail_url: sn.thumbnails?.high?.url || sn.thumbnails?.default?.url || null,
      subscriber_count: st.subscriberCount != null ? clampCount(parseInt(st.subscriberCount, 10)) : null,
      video_count: st.videoCount != null ? clampCount(parseInt(st.videoCount, 10)) : null,
      uploads_playlist_id: item.contentDetails?.relatedPlaylists?.uploads || uploadsPlaylistId(item.id),
      units: 0, // already logged above, and shared across the batch
      known: await isKnownChannel(item.id),
    });
  }
  return out;
}

/** Convenience: parse then resolve, falling back to search results. */
export async function resolveInput(input: string) {
  const ref = parseChannelInput(input);
  if (ref.kind === 'search') {
    return { ref, channel: null, suggestions: await searchTracked(ref.value) };
  }
  if (ref.kind === 'handle') {
    // A handle we already hold answers locally, for free. YouTube only sees new ones;
    // when it has never heard of the handle either, the fuzzy local search is the answer
    // ("@ilikemakestuff" -> I Like To Make Stuff).
    const local = await findByHandle(ref.value);
    if (local) return { ref, channel: fromDirectory(local), suggestions: [] as ChannelSearchResult[] };
    const channel = await resolveChannel(ref);
    return { ref, channel, suggestions: channel ? [] : await searchTracked(ref.value) };
  }
  return { ref, channel: await resolveChannel(ref), suggestions: [] as ChannelSearchResult[] };
}

function fromDirectory(r: ChannelSearchResult): ResolvedChannel {
  return {
    channel_id: r.channel_id,
    name: r.name,
    handle: r.handle ? `@${r.handle}` : null,
    thumbnail_url: r.avatar_url,
    subscriber_count: r.subscriber_count ?? null,
    video_count: r.video_count,
    uploads_playlist_id: uploadsPlaylistId(r.channel_id),
    units: 0,
    known: true,
  };
}

// ----------------------------------------------------------------- track ----

// A tracked channel gets its last year of uploads, capped at 300 videos (a daily uploader is
// already 365). The walk stops early at videos we already have. ~2 units per 50 videos.
export const BACKFILL_DEPTH = 300;
const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';

export class PlanLimitError extends Error {
  readonly code = 'plan_limit';
}

/** Fast sync for a channel we've never seen: RSS (free) + one videos.list (1 unit). */
export async function fastSync(channelId: string): Promise<{ inserted: number; units: number }> {
  let units = 0;
  let inserted = 0;
  let ids: string[] = [];
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) ids = parseRssVideoIds(await res.text());
  } catch {
    return { inserted: 0, units: 0 }; // dead feed; the catalog backfill will cover it
  }
  if (!ids.length) return { inserted: 0, units: 0 };

  const existing = await q<{ id: string }>(`select id from videos where id = any($1)`, [ids]);
  const known = new Set(existing.map((r) => r.id));
  const newIds = ids.filter((id) => !known.has(id));
  if (!newIds.length) return { inserted: 0, units: 0 };

  try {
    for (const group of chunk(newIds, 50)) {
      units += 1;
      const d = await ytJson(
        `${YT}/videos?part=snippet,statistics,contentDetails,liveStreamingDetails&id=${group.join(',')}&key=${apiKey()}`
      );
      inserted += await insertVideos(d.items || [], 'user');
    }
  } finally {
    await logQuota('app-resolve', units);
  }
  return { inserted, units };
}

/** Insert video rows + a same-day view_snapshots row. Idempotent. */
export async function insertVideos(items: any[], dataSource: 'user' | 'competitor'): Promise<number> {
  let n = 0;
  for (const v of items) {
    // One shared Shorts/live rule (lib/ingest/classify.ts): 63-180s clips are settled against
    // YouTube before they count as long-form; an unsettled one is stored unverified.
    const cls = await classifyForInsert(v);
    if (skipForInsert(cls.kind)) continue;
    const sn = v.snippet || {};
    const st = v.statistics || {};
    const views = clampCount(parseInt(st.viewCount || '0', 10));
    const likes = clampCount(parseInt(st.likeCount || '0', 10));
    const comments = clampCount(parseInt(st.commentCount || '0', 10));
    try {
      await q(
        `insert into videos (id, title, description, channel_id, channel_name, published_at,
                             view_count, like_count, comment_count, duration, thumbnail_url,
                             data_source, is_competitor, import_date, updated_at, user_id,
                             is_short, shorts_checked_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,now(),now(),$13,
                 $14, case when $15::boolean then now() else null end)
         on conflict (id) do update set
           is_short = case when excluded.shorts_checked_at is not null then excluded.is_short else videos.is_short end,
           shorts_checked_at = coalesce(excluded.shorts_checked_at, videos.shorts_checked_at)`,
        [v.id, sn.title || '', (sn.description || '').slice(0, 50000), sn.channelId,
         sn.channelTitle || '', sn.publishedAt, views, likes, comments,
         v.contentDetails?.duration || null,
         sn.thumbnails?.maxres?.url || sn.thumbnails?.high?.url || null,
         dataSource, SYSTEM_USER, cls.is_short, cls.shorts_checked_at === 'now']
      );
      // The response we just read IS an observation at a known instant, so it is recorded as
      // a sample too: a video imported days after publish is otherwise unmeasured until the
      // next tracker tick (lib/ingest/first-sample.ts).
      const broadcast = broadcastMetadataWrite(v);
      if (broadcast) await q(broadcast.sql, broadcast.params);
      const sample = firstSampleWrite(v, new Date());
      if (sample) await q(sample.sql, sample.params).catch(() => {});
      await q(
        `insert into view_snapshots (video_id, snapshot_date, view_count, like_count, comment_count, days_since_published)
         values ($1, current_date, $2, $3, $4, greatest(0, current_date - $5::date))
         on conflict (video_id, snapshot_date) do nothing`,
        [v.id, views, likes, comments, sn.publishedAt]
      );
      await q(
        `insert into view_tracking_priority (video_id, priority_tier, next_track_date)
         values ($1, 1, current_date + 1) on conflict (video_id) do nothing`,
        [v.id]
      ).catch(() => {});
      n++;
    } catch (e: any) {
      console.error(`insertVideos ${v.id}: ${e.message}`);
    }
  }
  return n;
}

/** Enroll the channel so the nightly ingest and thumbnail watcher pick it up. */
export async function enrollChannel(ch: ResolvedChannel): Promise<void> {
  await q(
    `insert into discovered_channels
       (channel_id, channel_title, channel_handle, subscriber_count, video_count, discovery_method)
     values ($1,$2,$3,$4,$5,'user_tracked')
     on conflict (channel_id) do nothing`,
    [ch.channel_id, ch.name || ch.channel_id, ch.handle, ch.subscriber_count, ch.video_count]
  );
}

export interface TrackResult {
  channel_id: string;
  role: 'self' | 'competitor';
  lane: 'user';
  enrolled: boolean;
  fast_synced: number;
  units: number;
  jobs_queued: number;
}

/**
 * Track a channel for a user: enforce plan limits, upsert user_channels,
 * promote the channel to the 'user' lane, fast-sync it if we've never seen it,
 * and queue the catalog + snapshots backfill jobs.
 */
export async function trackChannel(
  userId: string,
  channelId: string,
  role: 'self' | 'competitor' = 'competitor',
  opts: { watchedClosely?: boolean; resolved?: ResolvedChannel | null } = {}
): Promise<TrackResult> {
  if (!CHANNEL_ID_RE.test(channelId)) throw new Error(`not a channel id: ${channelId}`);

  const already = await one<{ x: number }>(
    `select 1 as x from user_channels where user_id = $1 and channel_id = $2`,
    [userId, channelId]
  );
  // Tracking is no longer capped by plan: the number a plan buys is how many channels it can
  // be NOTIFIED about (lib/app/groups-view.ts, notifyGate), which is the cost we actually
  // carry. Watching closely still costs dense sampling, so that limit stays.
  const usage = await planUsage(userId);
  const watched = !!opts.watchedClosely;
  if (watched) {
    const check = canWatchMoreClosely(usage.plan, usage.watchedClosely);
    if (!check.ok) throw new PlanLimitError(check.reason!);
  }

  await q(
    `insert into user_channels (user_id, channel_id, role, watched_closely)
     values ($1,$2,$3,$4)
     on conflict (user_id, channel_id) do update
       set role = excluded.role, watched_closely = excluded.watched_closely`,
    [userId, channelId, role, watched]
  );

  await q(
    `insert into channel_tracking (channel_id, lane, promoted_at, backfill_status, backfill_depth)
     values ($1, 'user', now(), 'queued', $2)
     on conflict (channel_id) do update
       set lane = 'user',
           promoted_at = case when channel_tracking.lane <> 'user' then now()
                              else coalesce(channel_tracking.promoted_at, now()) end,
           backfill_status = case when channel_tracking.backfill_status in ('done','running')
                                  then channel_tracking.backfill_status else 'queued' end,
           backfill_depth = coalesce(channel_tracking.backfill_depth, $2)`,
    [channelId, BACKFILL_DEPTH]
  );

  let enrolled = false;
  let fastSynced = 0;
  let units = 0;
  // A channel we already had in the library never went through resolve, so it has no
  // channel_meta (avatar, subscribers). Fetch it once (1 unit) so the UI has an identity.
  if (!(await channelMeta(channelId))) {
    const r = await resolveChannel({ kind: 'id', value: channelId }).catch(() => null);
    if (r) units += r.units; // resolveChannel saves channel_meta itself
  }
  const known = await isKnownChannel(channelId);
  if (!known) {
    const resolved = opts.resolved ?? (await resolveChannel({ kind: 'id', value: channelId }));
    if (resolved) {
      units += opts.resolved ? 0 : resolved.units;
      await enrollChannel(resolved);
      enrolled = true;
      await upsertDirectoryRow(resolved); // searchable now, not after tonight's rebuild
      const sync = await fastSync(channelId);
      fastSynced = sync.inserted;
      units += sync.units;
    }
  }

  let jobs = 0;
  for (const kind of ['catalog', 'snapshots'] as const) {
    const r = await q<{ id: string }>(
      `insert into backfill_jobs (channel_id, kind) values ($1, $2)
       on conflict (channel_id, kind) where status in ('queued','running')
       do nothing returning id`,
      [channelId, kind]
    );
    jobs += r.length;
  }

  // Seed the channel's row in channel_stats so /app/channels has numbers immediately (the
  // backfill jobs refresh it again when they finish). Never fails the track.
  await refreshChannelStats([channelId]).catch((e) => console.error('refreshChannelStats:', e.message));
  revalidateChannel(channelId);

  return { channel_id: channelId, role, lane: 'user', enrolled, fast_synced: fastSynced, units, jobs_queued: jobs };
}

/**
 * Stop tracking. The channel stays in the corpus (its videos are shared data);
 * it is demoted back to the 'corpus' lane once nobody tracks it, and any
 * still-queued backfill work is cancelled.
 */
export async function untrackChannel(userId: string, channelId: string): Promise<{ removed: boolean; demoted: boolean }> {
  const del = await q<{ channel_id: string }>(
    `delete from user_channels where user_id = $1 and channel_id = $2 returning channel_id`,
    [userId, channelId]
  );
  if (!del.length) return { removed: false, demoted: false };
  revalidateChannel(channelId);

  const others = await one<{ n: string }>(
    `select count(*) as n from user_channels where channel_id = $1`,
    [channelId]
  );
  if (parseInt(others?.n || '0', 10) > 0) return { removed: true, demoted: false };

  await q(`update channel_tracking set lane = 'corpus' where channel_id = $1`, [channelId]);
  await q(
    `update backfill_jobs set status = 'failed', finished_at = now(), error = 'untracked'
      where channel_id = $1 and status = 'queued'`,
    [channelId]
  );
  return { removed: true, demoted: true };
}

// ------------------------------------------------------------ user's list ----

export interface UserChannelRow {
  channel_id: string;
  name: string | null;
  role: string;
  watched_closely: boolean;
  added_at: string;
  lane: string | null;
  backfill_status: string | null;
  thumbnail_url: string | null;
  avatar_url: string | null;
  handle: string | null;
  video_count: number;
  baseline: number | null;
  outliers: number;
  last_packaging_change: string | null;
  notify: boolean;
  subscriber_count: number | null;
  /** Group ids this channel sits in, for this user. */
  groups: string[];
  /** When this channel last published — the subline's fact. */
  last_upload_at: string | null;
}

/**
 * The user's channel list with the headline numbers for /app/channels.
 *
 * The numbers come from channel_stats (lib/app/channel-stats.ts), refreshed by the ingest and
 * scoring runs. Computing them inline cost 4.3 s cold for 16 channels: three lateral
 * subqueries per channel over videos, video_scores and both version tables. A channel with no
 * stats row yet (added seconds ago, mid-backfill) falls back to zeros rather than vanishing.
 */
export async function listUserChannels(userId: string): Promise<UserChannelRow[]> {
  return q<UserChannelRow>(
    `select uc.channel_id,
            uc.role,
            uc.watched_closely,
            uc.notify,
            uc.added_at,
            ct.lane,
            ct.backfill_status,
            coalesce(cm.title, cs.name) as name,
            cs.latest_thumbnail_url as thumbnail_url,
            cm.avatar_url,
            cd.handle,
            coalesce(cs.video_count, 0)::int as video_count,
            cs.baseline,
            coalesce(cs.outliers, 0)::int as outliers,
            cs.last_packaging_change,
            -- bigint arrives from pg as a string; float8 comes back as a number, which is
            -- what compactNumber needs and is exact well past any subscriber count.
            cm.subscriber_count::float8 as subscriber_count,
            coalesce(gm.groups, '{}') as groups,
            lu.last_upload_at
       from user_channels uc
       left join channel_tracking ct on ct.channel_id = uc.channel_id
       left join channel_meta cm on cm.channel_id = uc.channel_id
       left join channel_stats cs on cs.channel_id = uc.channel_id
       left join channel_directory cd on cd.channel_id = uc.channel_id
       left join lateral (
         select array_agg(m.group_id::text) as groups
           from channel_group_members m
          where m.user_id = uc.user_id and m.channel_id = uc.channel_id
       ) gm on true
       -- The subline's fact. idx_videos_channel_published makes this one backward index
       -- probe per channel, so it rides along with the list instead of a second round trip.
       left join lateral (
         select v.published_at as last_upload_at
           from videos v
          where v.channel_id = uc.channel_id and v.published_at is not null
          order by v.published_at desc
          limit 1
       ) lu on true
      where uc.user_id = $1
      order by uc.added_at asc`,
    [userId]
  );
}
