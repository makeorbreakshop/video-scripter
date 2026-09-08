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
import { currentBaselineSql } from './channel-baseline';
import { changedVideoCountSql } from './packaging-rows';

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
       (channel_id, video_count, latest_thumbnail_url, name, baseline, outliers, last_packaging_change,
        packaging_change_count, last_upload_at, updated_at)
     select c.channel_id,
            coalesce(v.video_count, 0),
            v.thumbnail_url,
            v.name,
            s.baseline,
            coalesce(s.outliers, 0),
            ch.last_packaging_change,
            -- Both new columns exist to keep a page off the videos table: the Changes count was a 3-way
            -- join over the channel's whole catalogue on every channel page, and last_upload_at
            -- was a lateral probe into videos per channel on every /app/channels render.
            pkn.n,
            v.last_upload_at,
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
                 -- Free: this lateral is already reading the channel's rows.
                 max(vv.published_at) as last_upload_at,
                 (array_agg(vv.thumbnail_url order by vv.published_at desc)
                    filter (where vv.thumbnail_url is not null))[1] as thumbnail_url
            from videos vv where vv.channel_id = c.channel_id
       ) v on true
       left join lateral (
          -- baseline is the channel's normal NOW: C(30) from the newest scored long-form video
          -- (lib/app/channel-baseline.ts). It was a lifetime median over every score row, which
          -- misreported a third of channels by more than 2x. outliers is a count over the
          -- channel's HISTORY and is deliberately unchanged.
          select ${currentBaselineSql('c.channel_id')} as baseline,
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
       -- The Changes tab's count, from the ONE definition of it (lib/app/packaging-rows.ts).
       --
       -- Scoped refreshes only. This is a 3-way join over one channel's whole catalogue (~2,000
       -- shared blocks); across all 500 tracked channels in a single statement that is ~8 GB of
       -- buffer traffic against a 512 MB pool, which is exactly the kind of read this work
       -- exists to remove. The unscoped refresh therefore leaves the column alone (the upsert
       -- coalesces rather than overwriting) and scripts/refresh-packaging-counts.ts walks the
       -- channels one at a time, throttled, on its own schedule.
       left join lateral (
          ${scoped ? changedVideoCountSql('c.channel_id') : 'select null::int as n'}
       ) pkn on true
      where c.channel_id is not null
     on conflict (channel_id) do update set
        video_count = excluded.video_count,
        latest_thumbnail_url = excluded.latest_thumbnail_url,
        name = excluded.name,
        baseline = excluded.baseline,
        outliers = excluded.outliers,
        last_packaging_change = excluded.last_packaging_change,
        packaging_change_count = coalesce(excluded.packaging_change_count, channel_stats.packaging_change_count),
        last_upload_at = excluded.last_upload_at,
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
export async function touchPackagingChange(
  channelId: string,
  at: Date | string,
  /** True only when the video crossed from one packaging version to two — i.e. it has just
   *  joined the set the Changes count counts. A third version changes the timestamp and not the
   *  count, so passing false is the common case. */
  newlyChanged = false
): Promise<void> {
  if (!channelId) return;
  await q(
    `update channel_stats
        set last_packaging_change = greatest(last_packaging_change, $2::timestamptz),
            packaging_change_count = coalesce(packaging_change_count, 0) + $3::int,
            updated_at = now()
      where channel_id = $1`,
    [channelId, at instanceof Date ? at.toISOString() : at, newlyChanged ? 1 : 0]
  );
}

/**
 * Cheap path for an upload: the ingest already knows a video landed, and this is the only thing
 * the channel list needed `videos` for. greatest() so an out-of-order backfill cannot walk the
 * timestamp backwards.
 */
export async function touchLastUpload(channelId: string, publishedAt: Date | string): Promise<void> {
  if (!channelId || !publishedAt) return;
  await q(
    `update channel_stats
        set last_upload_at = greatest(last_upload_at, $2::timestamptz), updated_at = now()
      where channel_id = $1`,
    [channelId, publishedAt instanceof Date ? publishedAt.toISOString() : publishedAt]
  );
}
