// Materialized per-channel headline numbers for /app/channels and the channel header.
//
// listUserChannels used to compute these inline with three lateral subqueries per channel:
// for 16 channels that walked every video row, every video_scores row, and ~4,000
// thumbnail_versions/title_versions probes — 4.3 s cold. None of it changes between ingest
// runs, so it is computed once here and read as a plain join.
//
// Direct Postgres only (lib/admin/db.ts) — never supabase-js (2026-08-31 org-wide egress
// incident).
import { q } from '../admin/db';

/**
 * Recompute and upsert channel_stats. Pass the channels an ingest/scoring run touched;
 * omit the argument to refresh every tracked channel.
 *
 * The SQL below is deliberately identical in semantics to what listUserChannels computed
 * inline before. In particular the longform predicate (lib/scoring/longform.ts) is NOT
 * applied: video_count and the thumbnail here count Shorts too, exactly as the channel list
 * always has. The channel *page* does filter them (channelVideoCount), so the two numbers
 * differ — that is pre-existing behaviour, preserved on purpose rather than silently changed
 * as part of a performance pass.
 */
export async function refreshChannelStats(channelIds?: string[]): Promise<number> {
  if (channelIds && channelIds.length === 0) return 0;
  const scoped = !!channelIds?.length;
  const rows = await q<{ channel_id: string }>(refreshChannelStatsSql(scoped), scoped ? [channelIds] : []);
  return rows.length;
}

/**
 * The upsert as SQL, so the pipeline scripts (scripts/refresh-channel-stats.ts and the
 * nightly/scoring runs) can execute it on their own pg pool without importing the app's pool.
 * `scoped` true takes $1 = text[] of channel ids; false refreshes every tracked channel.
 */
export function refreshChannelStatsSql(scoped: boolean): string {
  return `insert into channel_stats
       (channel_id, video_count, latest_thumbnail_url, name, baseline, outliers, last_packaging_change, updated_at)
     select c.channel_id,
            coalesce(v.video_count, 0),
            v.thumbnail_url,
            v.name,
            s.baseline,
            coalesce(s.outliers, 0),
            ch.last_packaging_change,
            now()
       from (
         ${scoped
           ? `select unnest($1::text[]) as channel_id`
           : `select channel_id from user_channels
              union
              select channel_id from channel_tracking`}
       ) c
       left join lateral (
          select count(*)::int as video_count,
                 max(vv.channel_name) as name,
                 (array_agg(vv.thumbnail_url order by vv.published_at desc)
                    filter (where vv.thumbnail_url is not null))[1] as thumbnail_url
            from videos vv where vv.channel_id = c.channel_id
       ) v on true
       left join lateral (
          select percentile_cont(0.5) within group (order by vs.baseline) as baseline,
                 count(*) filter (where vs.score >= 2 and vs.confidence <> 'insufficient')::int as outliers
            from video_scores vs where vs.channel_id = c.channel_id
       ) s on true
       left join lateral (
          -- A packaging change is any version > 1 of a thumbnail or title on one of the
          -- channel's videos.
          select max(f) as last_packaging_change from (
            select max(tv.first_seen) as f
              from thumbnail_versions tv
              join videos vv2 on vv2.id = tv.video_id
             where vv2.channel_id = c.channel_id and tv.version > 1
            union all
            select max(ti.first_seen) as f
              from title_versions ti
              join videos vv3 on vv3.id = ti.video_id
             where vv3.channel_id = c.channel_id and ti.version > 1
          ) pk
       ) ch on true
      where c.channel_id is not null
     on conflict (channel_id) do update set
        video_count = excluded.video_count,
        latest_thumbnail_url = excluded.latest_thumbnail_url,
        name = excluded.name,
        baseline = excluded.baseline,
        outliers = excluded.outliers,
        last_packaging_change = excluded.last_packaging_change,
        updated_at = excluded.updated_at
     returning channel_id`;
}

/**
 * Cheap path for the watchers: a thumbnail or title version > 1 landed, so only
 * last_packaging_change moved. No aggregate recompute.
 *
 * UPDATE, not UPSERT: inserting a stub row here would give a channel a stats row whose
 * video_count/baseline are NULL, and the channel list would read that as zero until the next
 * refresh. A channel with no row yet picks the timestamp up from refreshChannelStats, which
 * computes last_packaging_change from the version tables anyway.
 */
export async function touchPackagingChange(channelId: string, at: Date | string): Promise<void> {
  if (!channelId) return;
  await q(
    `update channel_stats
        set last_packaging_change = greatest(last_packaging_change, $2::timestamptz),
            updated_at = now()
      where channel_id = $1`,
    [channelId, at instanceof Date ? at.toISOString() : at]
  );
}
