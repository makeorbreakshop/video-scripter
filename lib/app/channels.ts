// ChannelSmith channel operations: search the corpus, resolve arbitrary user
// input to a YouTube channel, and track/untrack it for a user.
//
// Direct Postgres only (lib/admin/db.ts) — never supabase-js (2026-08-31
// org-wide egress incident). Every YouTube API unit is written to quota_ledger.
import { q, one } from '../admin/db';
import { chunk, clampCount, parseRssVideoIds } from '../nightly/tracking-core';
import { canTrackMore, canWatchMoreClosely } from './plans';
import { planUsage } from './users';
import {
  ChannelRef, CHANNEL_ID_RE, bareHandle, parseChannelInput, uploadsPlaylistId,
} from './channels-core';

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
}

/**
 * Search the channels we already know about. pg_trgm is NOT installed on this
 * database, so this is a case-insensitive PREFIX match backed by the
 * text_pattern_ops indexes in sql/app-users.sql (plus the existing
 * idx_channels_channel_name_lower). Sources: videos.channel_name, the
 * discovered_channels registry, and the legacy channels registry;
 * competitor_youtube_channels supplies the corpus lane flag.
 */
export async function searchTracked(query: string, limit = 20): Promise<ChannelSearchResult[]> {
  const term = (query || '').trim().toLowerCase();
  if (term.length < 2) return [];
  const like = term.replace(/[%_\\]/g, '\\$&') + '%';
  const cap = Math.min(Math.max(limit, 1), 50);

  return q<ChannelSearchResult>(
    `with matches as (
        select channel_id, channel_name as name from (
          select distinct channel_id, channel_name from videos
           where lower(channel_name) like $1 and channel_id is not null
           limit 200
        ) v
        union
        select channel_id, name from (
          select channel_id, channel_title as name from discovered_channels
           where lower(channel_title) like $1 limit 100
        ) d
        union
        select channel_id, name from (
          select channel_id, channel_name as name from channels
           where lower(channel_name) like $1 limit 100
        ) c
     ),
     dedup as (
        select distinct on (channel_id) channel_id, name
          from matches where channel_id like 'UC%' order by channel_id, name
     )
     select d.channel_id,
            d.name,
            coalesce(vc.n, 0)::int as video_count,
            case when ct.lane is not null then ct.lane
                 when cy.youtube_channel_id is not null then 'corpus'
                 when vc.n > 0 then 'corpus'
                 else null end as tracked_lane
       from dedup d
       left join lateral (
          select count(*)::int as n from videos v where v.channel_id = d.channel_id
       ) vc on true
       left join channel_tracking ct on ct.channel_id = d.channel_id
       left join competitor_youtube_channels cy on cy.youtube_channel_id = d.channel_id
      order by video_count desc, d.name asc
      limit $2`,
    [like, cap]
  );
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
  return d.items?.[0] || null;
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

/** Convenience: parse then resolve, falling back to search results. */
export async function resolveInput(input: string) {
  const ref = parseChannelInput(input);
  if (ref.kind === 'search') {
    return { ref, channel: null, suggestions: await searchTracked(ref.value) };
  }
  return { ref, channel: await resolveChannel(ref), suggestions: [] as ChannelSearchResult[] };
}

// ----------------------------------------------------------------- track ----

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
        `${YT}/videos?part=snippet,statistics,contentDetails&id=${group.join(',')}&key=${apiKey()}`
      );
      inserted += await insertVideos(d.items || [], 'user');
    }
  } finally {
    await logQuota('app-resolve', units);
  }
  return { inserted, units };
}

/** True for Shorts and live content — excluded from the longform corpus. */
export function isShortOrLive(item: any): boolean {
  const dur: string = item?.contentDetails?.duration || '';
  const m = dur.match(/^PT(?:(\d+)M)?(?:(\d+)S)?$/);
  if (m) {
    const secs = parseInt(m[1] || '0', 10) * 60 + parseInt(m[2] || '0', 10);
    if (secs <= 62) return true;
  }
  const bc = item?.snippet?.liveBroadcastContent;
  return bc === 'live' || bc === 'upcoming';
}

/** Insert video rows + a same-day view_snapshots row. Idempotent. */
export async function insertVideos(items: any[], dataSource: 'user' | 'competitor'): Promise<number> {
  let n = 0;
  for (const v of items) {
    if (isShortOrLive(v)) continue;
    const sn = v.snippet || {};
    const st = v.statistics || {};
    const views = clampCount(parseInt(st.viewCount || '0', 10));
    const likes = clampCount(parseInt(st.likeCount || '0', 10));
    const comments = clampCount(parseInt(st.commentCount || '0', 10));
    try {
      await q(
        `insert into videos (id, title, description, channel_id, channel_name, published_at,
                             view_count, like_count, comment_count, duration, thumbnail_url,
                             data_source, is_competitor, import_date, updated_at, user_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,now(),now(),$13)
         on conflict (id) do nothing`,
        [v.id, sn.title || '', (sn.description || '').slice(0, 50000), sn.channelId,
         sn.channelTitle || '', sn.publishedAt, views, likes, comments,
         v.contentDetails?.duration || null,
         sn.thumbnails?.maxres?.url || sn.thumbnails?.high?.url || null,
         dataSource, SYSTEM_USER]
      );
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
  const usage = await planUsage(userId);
  if (!already) {
    const check = canTrackMore(usage.plan, usage.tracked);
    if (!check.ok) throw new PlanLimitError(check.reason!);
  }
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
           promoted_at = coalesce(channel_tracking.promoted_at, now()),
           backfill_status = case when channel_tracking.backfill_status in ('done','running')
                                  then channel_tracking.backfill_status else 'queued' end,
           backfill_depth = coalesce(channel_tracking.backfill_depth, $2)`,
    [channelId, BACKFILL_DEPTH]
  );

  let enrolled = false;
  let fastSynced = 0;
  let units = 0;
  const known = await isKnownChannel(channelId);
  if (!known) {
    const resolved = opts.resolved ?? (await resolveChannel({ kind: 'id', value: channelId }));
    if (resolved) {
      units += opts.resolved ? 0 : resolved.units;
      await enrollChannel(resolved);
      enrolled = true;
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
  video_count: number;
  baseline: number | null;
  outliers: number;
  last_packaging_change: string | null;
}

/** The user's channel list with the headline numbers for /app/channels. */
export async function listUserChannels(userId: string): Promise<UserChannelRow[]> {
  return q<UserChannelRow>(
    `select uc.channel_id,
            uc.role,
            uc.watched_closely,
            uc.added_at,
            ct.lane,
            ct.backfill_status,
            v.name,
            v.thumbnail_url,
            coalesce(v.video_count, 0)::int as video_count,
            s.baseline,
            coalesce(s.outliers, 0)::int as outliers,
            ch.last_packaging_change
       from user_channels uc
       left join channel_tracking ct on ct.channel_id = uc.channel_id
       left join lateral (
          select count(*)::int as video_count,
                 max(vv.channel_name) as name,
                 (array_agg(vv.thumbnail_url order by vv.published_at desc)
                    filter (where vv.thumbnail_url is not null))[1] as thumbnail_url
            from videos vv where vv.channel_id = uc.channel_id
       ) v on true
       left join lateral (
          select percentile_cont(0.5) within group (order by vs.baseline) as baseline,
                 count(*) filter (where vs.score >= 2) as outliers
            from video_scores vs where vs.channel_id = uc.channel_id
       ) s on true
       left join lateral (
          -- A packaging change is any version > 1 of a thumbnail or title on
          -- one of the channel's videos.
          select max(f) as last_packaging_change from (
            select max(tv.first_seen) as f
              from thumbnail_versions tv
              join videos vv2 on vv2.id = tv.video_id
             where vv2.channel_id = uc.channel_id and tv.version > 1
            union all
            select max(ti.first_seen) as f
              from title_versions ti
              join videos vv3 on vv3.id = ti.video_id
             where vv3.channel_id = uc.channel_id and ti.version > 1
          ) pk
       ) ch on true
      where uc.user_id = $1
      order by uc.added_at asc`,
    [userId]
  );
}
