// SQL for the archive/thin pipeline. Pure string construction — the runners own the pool.
//
// Two shapes matter here.
//
// 1. Reads are per (source, UTC day) and sorted by video_id, which is also the archive's row
//    order, so the parquet file and the checksum come out of the same scan.
// 2. Deletes are keyset by video_id — NOT by `limit` over the whole day. A video's readings
//    must be thinned as a set: if a batch cut a video in half, the window function would pick
//    the "last reading of the hour" out of half the evidence and delete the real one. So each
//    batch takes the next N whole videos (keyset on the pk's leading column) and thins exactly
//    those, which also keeps the statement under READING_RETENTION.batchSize rows.

import { READING_RETENTION, type ReadingSource } from './retention';

/**
 * Every ordering and every keyset comparison on video_id is byte-wise.
 *
 * The database's default collation is en_US.UTF-8, which sorts YouTube ids like `4_ZZnmQr7sI`
 * and `4-ZZnmQr7sI` by ignoring punctuation on the first pass — JavaScript's `<` compares code
 * units. Left as the default, `order by video_id` and sortForArchive() disagree, the parquet
 * file is written in one order and checksummed in another, and every day fails verification.
 * (Measured 2026-09-08: 28,941 rows written and read back, checksums different.)
 */
const C = `collate "C"`;

const LAUNCH_WINDOW_SQL = `${READING_RETENTION.launchWindowDays} days`;
const LAUNCH_DENSE_SQL = `${READING_RETENTION.launchDenseHours} hours`;

/** The two tables that hold raw readings, and the column each calls its clock. */
export const READING_TABLES = {
  rss: { table: 'rss_samples', ts: 'at', views: 'views', likes: 'likes', timeBasis: 'time_basis' },
  api: { table: 'view_samples', ts: 'sampled_at', views: 'view_count', likes: 'like_count', timeBasis: null },
} as const;

export function tableFor(source: ReadingSource) {
  const t = READING_TABLES[source];
  if (!t) throw new Error(`unknown reading source: ${source}`);
  return t;
}

/** Every reading of one UTC day, in archive order. $1 = day (YYYY-MM-DD). */
export function selectDaySql(source: ReadingSource): string {
  const t = tableFor(source);
  const basis = t.timeBasis ? `${t.timeBasis}` : `null::text`;
  return `
    select video_id,
           ${t.ts} as at,
           ${t.views}::bigint as views,
           ${t.likes}::bigint as likes,
           '${source}'::text as source,
           ${basis} as time_basis
      from ${t.table}
     where ${t.ts} >= $1::date and ${t.ts} < ($1::date + interval '1 day')
     order by video_id ${C}, ${t.ts}`;
}

/**
 * One day's readings for a named set of videos, in archive order. The streaming form of
 * selectDaySql: a day of rss_samples is ~1.7 M rows, so the archiver walks it in video_id
 * keyset chunks (nextVideosSql) and feeds each chunk straight into the parquet writer.
 * $1 = day, $2 = video_id[].
 */
export function selectDayForVideosSql(source: ReadingSource): string {
  const t = tableFor(source);
  const basis = t.timeBasis ? `${t.timeBasis}` : `null::text`;
  return `
    select video_id,
           ${t.ts} as at,
           ${t.views}::bigint as views,
           ${t.likes}::bigint as likes,
           '${source}'::text as source,
           ${basis} as time_basis
      from ${t.table}
     where ${t.ts} >= $1::date and ${t.ts} < ($1::date + interval '1 day')
       and video_id = any($2)
     order by video_id ${C}, ${t.ts}`;
}

/** Row count of one UTC day, for the pre-flight and the verification table. $1 = day. */
export function countDaySql(source: ReadingSource): string {
  const t = tableFor(source);
  return `select count(*)::bigint as n from ${t.table}
           where ${t.ts} >= $1::date and ${t.ts} < ($1::date + interval '1 day')`;
}

/** The oldest day that still has rows, or null. */
export function oldestDaySql(source: ReadingSource): string {
  const t = tableFor(source);
  return `select (min(${t.ts}) at time zone 'UTC')::date::text as day from ${t.table}`;
}

/**
 * The next batch of whole videos to thin inside one day, keyset on video_id.
 * $1 = day, $2 = cursor video_id (use '' to start), $3 = how many videos.
 */
export function nextVideosSql(source: ReadingSource): string {
  const t = tableFor(source);
  // group by rather than distinct: `select distinct x order by x collate "C"` is rejected
  // (the ORDER BY expression must be in the select list), and the collation is not optional.
  return `select video_id from ${t.table}
           where ${t.ts} >= $1::date and ${t.ts} < ($1::date + interval '1 day')
             and video_id ${C} > $2
           group by video_id
           order by video_id ${C} limit $3`;
}

export type Bucket = 'hour' | 'day';

/**
 * Delete everything but (a) the last reading of each (video, bucket) and (b) the first reading
 * of each (video, day), for the given videos on the given day. $1 = day, $2 = video_id[].
 *
 * `order by at desc, ctid desc` is the same tie-break as retention.ts `newer()`, and `rn_first`
 * mirrors the first-of-day rule there, so the pure survivingReadings() and this statement always
 * agree on which row lives. The first-of-day row is kept because lib/scoring/core.ts
 * growthExponent() reads a video's earliest and latest readings and nothing in between.
 */
export function thinBatchSql(source: ReadingSource, bucket: Bucket): string {
  const t = tableFor(source);
  // In the daily tier the bucket is still the hour for readings inside the video's launch
  // window — see READING_RETENTION.launchWindowDays and the 213 % deviation it was added for.
  const part = bucket === 'hour'
    ? `date_trunc('hour', s0.${t.ts} at time zone 'UTC')`
    : `case when s0.${t.ts} < v.published_at + interval '${LAUNCH_WINDOW_SQL}'
             then date_trunc('hour', s0.${t.ts} at time zone 'UTC')
             else date_trunc('day',  s0.${t.ts} at time zone 'UTC') end`;
  return `
    with doomed as (
      select ctid from (
        select s0.ctid,
               row_number() over (
                 partition by s0.video_id, ${part}
                 order by s0.${t.ts} desc, s0.ctid desc
               ) as rn,
               row_number() over (
                 partition by s0.video_id, (s0.${t.ts} at time zone 'UTC')::date,
                              (coalesce(s0.${t.views}, 0) > 0)
                 order by s0.${t.ts} asc, s0.ctid asc
               ) as rn_first,
               (s0.${t.ts} < v.published_at + interval '${LAUNCH_DENSE_SQL}') as launch_dense
          from ${t.table} s0
          join videos v on v.id = s0.video_id
         where s0.${t.ts} >= $1::date and s0.${t.ts} < ($1::date + interval '1 day')
           and s0.video_id = any($2)
      ) x where rn > 1 and rn_first > 1 and not launch_dense
    )
    delete from ${t.table} s using doomed d where s.ctid = d.ctid`;
}

/** Videos per batch, so one statement stays under batchSize rows at the given readings/video/day. */
export function videosPerBatch(readingsPerVideoPerDay: number, batchSize = READING_RETENTION.batchSize): number {
  const per = Math.max(1, Math.floor(readingsPerVideoPerDay));
  return Math.max(1, Math.floor(batchSize / per));
}

// ---- video_score_history --------------------------------------------------------------
// Nothing reads this table (2026-09-08 investigation: one writer, zero readers outside a
// one-shot migration). It is archived rather than dropped so a future reader is not blocked.

export const HISTORY_SELECT_DAY_SQL = `
  select id, video_id, channel_id, model_version, scored_at, age_days, views, score,
         same_age_ratio, typical_at_age, n_typical, typical_measured_share, projection,
         projection_horizon, est30, baseline, n_baseline, confidence, extra
    from video_score_history
   where scored_at >= $1::date and scored_at < ($1::date + interval '1 day')
   order by video_id collate "C", scored_at, id`;

export const HISTORY_COUNT_DAY_SQL = `
  select count(*)::bigint as n from video_score_history
   where scored_at >= $1::date and scored_at < ($1::date + interval '1 day')`;

export const HISTORY_OLDEST_DAY_SQL =
  `select (min(scored_at) at time zone 'UTC')::date::text as day from video_score_history`;

/** Delete one day of history in id-keyset batches. id is bigint. $1 = day, $2 = id cursor, $3 = batch size. */
export const HISTORY_DELETE_BATCH_SQL = `
  with doomed as (
    select id from video_score_history
     where scored_at >= $1::date and scored_at < ($1::date + interval '1 day')
       and id > $2::bigint
     order by id limit $3
  )
  delete from video_score_history h using doomed d where h.id = d.id
  returning h.id`;

// ---- the ledger -----------------------------------------------------------------------

export const ARCHIVE_LEDGER_DDL = `
  create table if not exists readings_archive_days (
    day        date        not null,
    source     text        not null check (source in ('rss','api','history')),
    rows       bigint      not null,
    bytes      bigint      not null,
    checksum   text        not null,
    object_key text        not null,
    written_at timestamptz not null default now(),
    verified_at timestamptz,
    primary key (day, source)
  )`;

/** Idempotent: re-running a day overwrites its ledger row, as it overwrites its R2 key. */
export const LEDGER_UPSERT_SQL = `
  insert into readings_archive_days (day, source, rows, bytes, checksum, object_key, written_at, verified_at)
  values ($1::date, $2, $3, $4, $5, $6, now(), $7)
  on conflict (day, source) do update set
    rows = excluded.rows, bytes = excluded.bytes, checksum = excluded.checksum,
    object_key = excluded.object_key, written_at = excluded.written_at,
    verified_at = excluded.verified_at`;

export const LEDGER_SELECT_SQL = `
  select day::text as day, source, rows::bigint as rows, bytes::bigint as bytes,
         checksum, object_key, written_at, verified_at
    from readings_archive_days order by day, source`;

/** Indexes the keyset thinning walks. Both already exist as primary keys; this is the guard. */
export const REQUIRED_INDEXES = [
  { table: 'rss_samples', index: 'rss_samples_pkey', columns: '(video_id, at)' },
  { table: 'view_samples', index: 'view_samples_pkey', columns: '(video_id, sampled_at)' },
  { table: 'rss_samples', index: 'idx_rss_samples_at', columns: '(at desc)' },
] as const;

/** A day-bounded scan of view_samples has no index today; this one makes the archive read cheap. */
export const CREATE_VIEW_SAMPLES_AT_INDEX =
  `create index concurrently if not exists idx_view_samples_sampled_at on view_samples (sampled_at)`;

export const CREATE_HISTORY_SCORED_AT_INDEX =
  `create index concurrently if not exists idx_vsh_scored_at on video_score_history (scored_at)`;
