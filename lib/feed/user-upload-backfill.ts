export const USER_UPLOAD_BACKFILL_PREFIX = 'feed.user-upload-backfill:';
export const USER_UPLOAD_BACKFILL_COMPLETE = '__complete__';

export interface BackfillCursor { at: string; id: string }
export interface BackfillChannel { channelId: string; watermarkSource: string; cursor: BackfillCursor | null }

export const unfinishedUserUploadChannelsSql = (limit: number) => `
  select ct.channel_id,
         '${USER_UPLOAD_BACKFILL_PREFIX}' || ct.channel_id || ':' || ct.promoted_at::text as watermark_source,
         w.last_at::text as cursor_at,
         nullif(w.last_id, '${USER_UPLOAD_BACKFILL_COMPLETE}') as cursor_id
    from channel_tracking ct
    left join feed_watermarks w
      on w.source = '${USER_UPLOAD_BACKFILL_PREFIX}' || ct.channel_id || ':' || ct.promoted_at::text
   where ct.lane = 'user'
     and ct.backfill_status in ('done', 'failed')
     and (w.source is null or w.last_id <> '${USER_UPLOAD_BACKFILL_COMPLETE}')
   order by (w.source is null) desc, w.last_at desc nulls first, ct.channel_id
   limit ${limit}`;

/** Descending keyset page. PostgreSQL text preserves timestamp microseconds for the next bind. */
export const userUploadBackfillPageSql = (hasCursor: boolean, limit: number) => `
  select v.id as video_id, v.channel_id, v.title,
         v.published_at::text as published_at, v.import_date
    from videos v
   where v.channel_id = $1
     and v.published_at is not null
     ${hasCursor ? 'and (v.published_at, v.id) < ($2::timestamptz, $3)' : ''}
   order by v.published_at desc nulls last, v.id desc
   limit ${limit}`;

export interface BackfillUnit<Row> {
  channel: BackfillChannel;
  rows: Row[];
  complete: boolean;
  cursor: BackfillCursor | null;
}

/** Builds bounded, fair work units. Persistence is deliberately left to one transaction per unit. */
export async function buildUserUploadBackfillUnits<Row extends { video_id: string; published_at: string }>(options: {
  channels: BackfillChannel[];
  pageSize: number;
  globalLimit: number;
  aborted?: () => boolean;
  fetchPage: (channel: BackfillChannel, limit: number) => Promise<Row[]>;
}): Promise<BackfillUnit<Row>[]> {
  const units: BackfillUnit<Row>[] = [];
  let remaining = options.globalLimit;
  for (const channel of options.channels) {
    if (remaining <= 0 || options.aborted?.()) break;
    const limit = Math.min(options.pageSize, remaining);
    const rows = await options.fetchPage(channel, limit);
    const last = rows.at(-1);
    units.push({
      channel,
      rows,
      complete: rows.length < limit,
      cursor: last ? { at: last.published_at, id: last.video_id } : channel.cursor,
    });
    remaining -= rows.length;
  }
  return units;
}
