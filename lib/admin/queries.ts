// All admin SQL lives here so the CLI (next step) can reuse the same functions.
import { unstable_cache } from 'next/cache';
import { q, one } from './db';

export type DayCount = { day: string; n: number };

const TOTALS_SQL = `select
         (select reltuples::bigint from pg_class where relname='videos') as videos,
         (select reltuples::bigint from pg_class where relname='view_snapshots') as snapshots,
         (select count(*) from (select 1 from videos where published_at > now() - interval '30 days' group by channel_id) s)::int as channels_30d,
         (select count(*) from videos where published_at > now() - interval '30 days')::int as videos_30d,
         (select count(distinct video_id) from thumbnail_versions)::int as watched,
         (select count(*) from thumbnail_versions where last_checked >= now() - interval '24 hours')::int as checked_24h,
         (select case when n_distinct < 0 then (-n_distinct * (select reltuples from pg_class where relname='videos'))::bigint else n_distinct::bigint end from pg_stats where tablename='videos' and attname='channel_id') as channels`;

async function overviewTotals() {
  return one<{
      videos: number;
      channels: number;
      snapshots: number;
      watched: number;
      checked_24h: number;
      videos_30d: number;
      channels_30d: number;
    }>(TOTALS_SQL);
}
const cachedTotals = unstable_cache(overviewTotals, ['admin-overview-totals'], { revalidate: 600 });

export async function overview() {
  const [totals, ingest14, snaps14, thumbs14, queue, quota, tiers, changes7] = await Promise.all([
    cachedTotals(),
    q<DayCount>(
      `select import_date::date::text as day, count(*)::int as n
       from videos where import_date >= current_date - 13 group by 1 order by 1`
    ),
    q<DayCount>(
      `select snapshot_date::text as day, count(*)::int as n
       from view_snapshots where snapshot_date >= current_date - 13 group by 1 order by 1`
    ),
    q<{ day: string; changes: number; captures: number }>(
      `select first_seen::date::text as day,
              count(*) filter (where version > 1)::int as changes,
              count(*) filter (where version = 1)::int as captures
       from thumbnail_versions where first_seen >= current_date - 13 group by 1 order by 1`
    ),
    one<{ pending: number; processed_24h: number; oldest: string | null }>(
      `select count(*) filter (where processed_at is null)::int as pending,
              count(*) filter (where processed_at >= now() - interval '24 hours')::int as processed_24h,
              min(seen_at) filter (where processed_at is null) as oldest
       from touch_queue`
    ),
    q<{ category: string; units: number }>(
      `select category, sum(units)::int as units from quota_ledger
       where date = current_date group by category order by units desc`
    ),
    q<{ tier: number; n: number; due: number }>(
      `select priority_tier as tier, count(*)::int as n,
              count(*) filter (where next_track_date <= current_date)::int as due
       from view_tracking_priority group by 1 order by 1`
    ),
    one<{ n: number }>(
      `select count(*)::int as n from thumbnail_versions
       where version > 1 and first_seen >= now() - interval '7 days'`
    ),
  ]);
  return { totals, ingest14, snaps14, thumbs14, queue, quota, tiers, changes7: changes7?.n ?? 0 };
}

export type ThumbVersion = { version: number; sha256: string; first_seen: string; last_checked: string };
export type ThumbHistory = {
  video_id: string;
  title: string;
  channel_id: string;
  channel_name: string;
  published_at: string;
  view_count: number;
  is_live: boolean;
  last_change: string;
  versions: ThumbVersion[];
};

// One row per video that has ever changed its thumbnail, with the full version list.
export async function thumbnailHistories(limit = 100, channelId?: string, includeLive = false) {
  return q<ThumbHistory>(
    `with changed as (
       select video_id, max(first_seen) as last_change
       from thumbnail_versions where version > 1 group by video_id
       ${channelId ? 'having bool_or(video_id in (select id from videos where channel_id = $2))' : ''}
       order by last_change desc limit $1)
     select c.video_id, c.last_change, v.title, v.channel_id, v.channel_name, v.published_at, v.view_count,
            (v.duration = 'P0D') as is_live,
            (select json_agg(json_build_object('version', t.version, 'sha256', t.sha256,
                                               'first_seen', t.first_seen, 'last_checked', t.last_checked)
                             order by t.version)
             from thumbnail_versions t where t.video_id = c.video_id) as versions
     from changed c join videos v on v.id = c.video_id
     ${includeLive ? '' : "where coalesce(v.duration, '') <> 'P0D'"}
     order by c.last_change desc`,
    channelId ? [limit, channelId] : [limit]
  );
}

// Label each distinct image A, B, C… in order of first appearance so a rotation reads "A → B → A → B".
export function labelVersions(versions: ThumbVersion[]) {
  const seen = new Map<string, string>();
  return versions.map((v) => {
    const repeat = seen.has(v.sha256);
    if (!repeat) seen.set(v.sha256, String.fromCharCode(65 + seen.size));
    return { ...v, label: seen.get(v.sha256)!, repeat };
  });
}

// "A → B → A → B" plus a one-word read of what it probably is.
// Live streams (duration P0D at import) get a fresh frame from the feed on every poll —
// those are not packaging changes and are labeled as such.
export function describeHistory(versions: ThumbVersion[], isLive = false) {
  const labeled = labelVersions(versions);
  const distinct = new Set(labeled.map((l) => l.label)).size;
  const repeats = labeled.filter((l) => l.repeat).length;
  const kind = isLive
    ? 'live stream frames'
    : repeats > 0 ? 'test rotation' : distinct > 2 ? 'multiple swaps' : 'single swap';
  return { labeled, distinct, kind, pattern: labeled.map((l) => l.label).join(' → ') };
}

export type ChannelRow = {
  channel_id: string;
  channel_name: string;
  videos_30d: number;
  videos_total: number | null;
  latest: string;
  views_30d: number;
  thumb_changes: number;
};

async function channelListUncached(limit: number) {
  return q<ChannelRow>(
    `with recent as (
       select channel_id, max(channel_name) as channel_name, count(*)::int as videos_30d,
              max(published_at) as latest, sum(view_count)::bigint as views_30d
       from videos where published_at > now() - interval '30 days' and channel_id is not null
       group by channel_id)
     , changes as (
       select x.channel_id, count(*)::int as thumb_changes
       from thumbnail_versions t join videos x on x.id = t.video_id
       where t.version > 1 group by x.channel_id)
     select r.*, null::int as videos_total, coalesce(c.thumb_changes, 0) as thumb_changes
     from recent r left join changes c on c.channel_id = r.channel_id
     order by videos_30d desc, latest desc limit $1`,
    [limit]
  );
}
const cachedChannelList = unstable_cache(channelListUncached, ['admin-channel-list'], { revalidate: 600 });

export async function channels(search?: string, limit = 200) {
  if (search) {
    return q<ChannelRow>(
      `select v.channel_id, max(v.channel_name) as channel_name,
              count(*) filter (where v.published_at > now() - interval '30 days')::int as videos_30d,
              count(*)::int as videos_total,
              max(v.published_at) as latest,
              coalesce(sum(v.view_count) filter (where v.published_at > now() - interval '30 days'),0)::bigint as views_30d,
              coalesce(max(c.thumb_changes), 0) as thumb_changes
       from videos v
       left join (select x.channel_id, count(*)::int as thumb_changes
                  from thumbnail_versions t join videos x on x.id = t.video_id
                  where t.version > 1 group by x.channel_id) c on c.channel_id = v.channel_id
       where v.channel_name ilike $1 or v.channel_id = $2
       group by v.channel_id order by latest desc nulls last limit $3`,
      [`%${search}%`, search, limit]
    );
  }
  return cachedChannelList(limit);
}

export type VideoRow = {
  id: string;
  title: string;
  published_at: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  temporal_performance_score: number | null;
  priority_tier: number | null;
  last_tracked: string | null;
  snapshots: number;
  thumb_versions: number;
  is_short: boolean | null;
};

export async function channelDetail(channelId: string) {
  const [channel, videos, snapDays] = await Promise.all([
    one<{ channel_id: string; channel_name: string; videos_total: number; first: string; latest: string }>(
      `select channel_id, max(channel_name) as channel_name, count(*)::int as videos_total,
              min(published_at) as first, max(published_at) as latest
       from videos where channel_id = $1 group by channel_id`,
      [channelId]
    ),
    q<VideoRow>(
      `select v.id, v.title, v.published_at, v.view_count, v.like_count, v.comment_count,
              v.temporal_performance_score, v.is_short,
              p.priority_tier, p.last_tracked,
              (select count(*)::int from view_snapshots s where s.video_id = v.id) as snapshots,
              (select coalesce(max(version),0)::int from thumbnail_versions t where t.video_id = v.id) as thumb_versions
       from videos v left join view_tracking_priority p on p.video_id = v.id
       where v.channel_id = $1
       order by v.published_at desc limit 100`,
      [channelId]
    ),
    q<DayCount>(
      `select s.snapshot_date::text as day, count(*)::int as n
       from view_snapshots s join videos v on v.id = s.video_id
       where v.channel_id = $1 and s.snapshot_date >= current_date - 29
       group by 1 order by 1`,
      [channelId]
    ),
  ]);
  return { channel, videos, snapDays };
}

export async function videoDetail(id: string) {
  const [video, snapshots, versions] = await Promise.all([
    one<any>(
      `select v.id, v.title, v.channel_id, v.channel_name, v.published_at, v.view_count, v.like_count,
              v.comment_count, v.duration, v.thumbnail_url, v.temporal_performance_score,
              v.envelope_performance_ratio, v.envelope_performance_category, v.channel_baseline_at_publish,
              v.format_type, v.topic_niche, v.is_short, v.import_date, v.data_source,
              p.priority_tier, p.priority_score, p.last_tracked, p.next_track_date, p.reason
       from videos v left join view_tracking_priority p on p.video_id = v.id where v.id = $1`,
      [id]
    ),
    q<{ day: string; view_count: number; like_count: number; comment_count: number; days_since_published: number }>(
      `select snapshot_date::text as day, view_count, like_count, comment_count, days_since_published
       from view_snapshots where video_id = $1 order by snapshot_date`,
      [id]
    ),
    q<{ version: number; sha256: string; bytes: number; first_seen: string; last_checked: string }>(
      `select version, sha256, bytes, first_seen, last_checked
       from thumbnail_versions where video_id = $1 order by version`,
      [id]
    ),
  ]);
  return { video, snapshots, versions };
}

// Channel-relative outliers among recent videos, computed live from snapshots (the validated
// "same-age ratio": this video's latest snapshot vs the median of the channel's last <=10 prior
// videos at the same age, >=3 comparables). Confidence by age: <3d early, 3-6d likely, >=7d confirmed.
// Heavy query (~10-20s), cached 15 min. Replaces the legacy temporal_performance_score (unit bug, capped).
export type OutlierRow = {
  id: string; title: string; channel_id: string; channel_name: string; published_at: string;
  day: number; views: number; ch_median: number; n: number; ratio: number;
};

async function recentOutliersUncached(days: number, limit: number, minMedian: number) {
  return q<OutlierRow>(
    `with recent as (
       select v.id, v.channel_id, v.channel_name, v.title, v.published_at
       from videos v
       where v.published_at > now() - ($1 || ' days')::interval
         and coalesce(v.is_short,false)=false and coalesce(v.duration,'')<>'P0D' and coalesce(v.is_institutional,false)=false),
     latest as (
       select distinct on (s.video_id) s.video_id, s.days_since_published as d, s.view_count as vt
       from view_snapshots s join recent r on r.id = s.video_id
       where s.days_since_published between 1 and 30 and s.view_count > 0
       order by s.video_id, s.snapshot_date desc),
     priors as (
       select r.id as video_id, p.id as prior_id
       from recent r join lateral (
         select p.id from videos p
         where p.channel_id = r.channel_id and p.published_at < r.published_at and coalesce(p.is_short,false)=false
         order by p.published_at desc limit 10) p on true),
     comps as (
       select l.video_id, percentile_cont(0.5) within group (order by s.view_count) as med, count(*)::int as n
       from latest l join priors pr on pr.video_id = l.video_id
       join view_snapshots s on s.video_id = pr.prior_id
         and abs(s.days_since_published - l.d) <= greatest(1, l.d / 4) and s.view_count > 0
       group by l.video_id)
     select r.id, r.title, r.channel_id, r.channel_name, r.published_at,
            l.d as day, l.vt as views, round(c.med)::int as ch_median, c.n,
            round((l.vt / c.med)::numeric, 2)::float as ratio
     from recent r join latest l on l.video_id = r.id join comps c on c.video_id = r.id
     where c.n >= 3 and c.med >= $3
     order by ratio desc limit $2`,
    [days, limit, minMedian]
  );
}
const cachedOutliers = unstable_cache(recentOutliersUncached, ['admin-outliers-v2'], { revalidate: 900 });

export async function recentOutliers(days = 14, limit = 60, minMedian = 100) {
  return cachedOutliers(days, limit, minMedian);
}

export function confidenceForDay(day: number) {
  return day < 3 ? 'early' : day < 7 ? 'likely' : 'confirmed';
}
