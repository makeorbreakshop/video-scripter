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
  rss: { table: 'rss_samples', ts: 'at', views: 'views', likes: 'likes', timeBasis: 'time_basis',
         // Only rss_samples carries the scorer's eligibility flags (lib/scoring/observations.ts).
         flags: 'model_eligible, conflicted, received_at' },
  api: { table: 'view_samples', ts: 'sampled_at', views: 'view_count', likes: 'like_count', timeBasis: null,
         flags: 'true as model_eligible, false as conflicted, null::timestamptz as received_at' },
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
           ${basis} as time_basis,
           ${t.flags}
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
           ${basis} as time_basis,
           ${t.flags}
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

/**
 * EVERY distinct video in one UTC day, in archive order. One statement, one scan, per day.
 *
 * nextVideosSql() above is a keyset cursor, and on this table it is a trap. The pk is
 * (video_id, at), so a query filtered on `at` and grouped by `video_id` cannot walk the index in
 * video_id order — it aggregates the whole day and takes the top N. Measured on rss 2026-09-05
 * (2026-09-14): 1.6 GB of buffer traffic and 1,195 ms to return 52 ids, and the day has 98,947
 * distinct videos, so a full pass paid that 1,903 times — 38 minutes of cursoring per day before
 * one row was deleted. That is what made a no-op day cost 3.5 minutes.
 *
 * The whole list is ~11 bytes per video, ~1.1 MB for the biggest day. Read it once, slice it in
 * memory with thin-safety.ts chunk(), and the per-batch cost becomes the delete alone.
 *
 * $1 = day (YYYY-MM-DD).
 */
export function dayVideosSql(source: ReadingSource): string {
  const t = tableFor(source);
  return `select video_id from ${t.table}
           where ${t.ts} >= $1::date and ${t.ts} < ($1::date + interval '1 day')
           group by video_id
           order by video_id ${C}`;
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
  // Doomed rows are identified by the PRIMARY KEY (video_id, <ts>) and deleted in that order.
  //
  // This used to select and delete by `ctid`. ctid names a row just as exactly, but it is
  // PHYSICAL order, and that is what deadlocked the 2026-09-14 run against live RSS ingestion:
  // both transactions reach the same obs_cache_dirty / score_dirty / series_dirty rows through
  // the Sep 11 statement triggers, the writer in video_id order and the thinner in heap order.
  // Taking the rows in key order makes the two agree. Nothing is lost by the change: the pk is
  // unique, so (video_id, <ts>) cannot name more than one row, and the `ctid` tie-breaks inside
  // the window functions are kept because they still order rows that share a timestamp.
  return `
    with doomed as (
      select video_id, ${t.ts} from (
        select s0.video_id, s0.${t.ts},
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
      order by video_id ${C}, ${t.ts}
    )
    delete from ${t.table} s using doomed d
     where s.video_id = d.video_id and s.${t.ts} = d.${t.ts}`;
}

/**
 * Suppress the Sep 11 observation-delta triggers for the duration of one transaction.
 *
 * THE DESIGN DECISION, and why it is this one (docs/runbooks/2026-09-14-thin-deadlock.md):
 *
 * A thinning delete is NOT a correction. lib/readings/retention.ts chooses the survivor set so
 * that every value a consumer can compute is unchanged — the last reading of each bucket, plus
 * the first reading of each (video, day, views>0) because growthExponent() reads exactly those
 * two rows. scripts/verify-archive.ts measured that directly: 0 of 200 videos changed a
 * score-affecting bin, max deviation 0.000 %. So the obs cache and the series files do not need
 * to hear about it; rebuilding either from the survivors produces the same answer.
 *
 * Propagating anyway would be actively harmful. 9.4 M delete deltas would append 9.4 M rows to
 * observation_change_log — growing the database during a disk-pressure emergency whose whole
 * point is to shrink it — and would mark essentially the entire live corpus dirty in
 * obs_cache_dirty, score_dirty AND series_dirty at once. That is a full corpus re-materialisation
 * and a full re-score: precisely the unbounded raw-history traffic the 2026-09-11 egress rework
 * exists to prevent. The disk fix would re-create the egress incident.
 *
 * A GUC rather than `alter table … disable trigger`: the ALTER takes ACCESS EXCLUSIVE on a
 * 2.2 GB table the RSS poller writes to continuously, which would stall every live writer for
 * the length of the run, and it is a global change that outlives a crashed session. `set local`
 * is transaction-scoped, takes no lock, cannot leak past a rollback, and is the one form
 * Supavisor's :6543 transaction pooler honours (lib/admin/db.ts).
 */
export const THIN_SUPPRESS_DELTAS_SQL =
  `set local channelsmith.suppress_observation_deltas = 'on'`;

/**
 * The preamble for a thinning transaction: bound the statement, bound the LOCK WAIT, and
 * suppress the delete deltas — in one simple-protocol round trip.
 *
 * lock_timeout is the part that was missing. Without it a batch blocked behind a live writer
 * waits for the whole statement_timeout (600 s) while holding every lock it has already taken,
 * which is what turns ordinary contention into a deadlock. With it the batch gives up in
 * seconds and lib/readings/thin-safety.ts retries it.
 */
export function thinTransactionPreamble(statementTimeoutMs: number, lockTimeoutMs: number): string {
  const s = Math.max(1, Math.round(statementTimeoutMs));
  const l = Math.max(1, Math.round(lockTimeoutMs));
  return `begin; set local statement_timeout = ${s}; set local lock_timeout = ${l}; ` +
         THIN_SUPPRESS_DELTAS_SQL;
}

/** Videos per batch, so one statement stays under batchSize rows at the given readings/video/day. */
export function videosPerBatch(readingsPerVideoPerDay: number, batchSize: number = READING_RETENTION.batchSize): number {
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
    -- What the last thinning pass reduced this day to. Same tier + unchanged row count means
    -- tonight's pass has provably nothing to do and can skip the walk entirely.
    thinned_tier text check (thinned_tier is null or thinned_tier in ('hour','day')),
    thinned_rows bigint,
    primary key (day, source)
  )`;

/** Additive, for a ledger created before 2026-09-14. Cheap and idempotent; no table rewrite. */
export const ARCHIVE_LEDGER_THINNED_DDL = `
  alter table readings_archive_days
    add column if not exists thinned_tier text,
    add column if not exists thinned_rows bigint`;

/** Idempotent: re-running a day overwrites its ledger row, as it overwrites its R2 key. */
export const LEDGER_UPSERT_SQL = `
  insert into readings_archive_days (day, source, rows, bytes, checksum, object_key, written_at, verified_at)
  values ($1::date, $2, $3, $4, $5, $6, now(), $7)
  on conflict (day, source) do update set
    rows = excluded.rows, bytes = excluded.bytes, checksum = excluded.checksum,
    object_key = excluded.object_key, written_at = excluded.written_at,
    verified_at = excluded.verified_at`;
    // thinned_tier / thinned_rows are deliberately NOT reset here. They describe Postgres, not
    // the archive, and decideThin() compares thinned_rows against the live count anyway — so a
    // day that was re-archived because it grew is re-thinned on the count, not on a cleared flag.

export const LEDGER_SELECT_SQL = `
  select day::text as day, source, rows::bigint as rows, bytes::bigint as bytes,
         checksum, object_key, written_at, verified_at,
         thinned_tier, thinned_rows::bigint as thinned_rows
    from readings_archive_days order by day, source`;

/** Record what a thinning pass left behind, so the next night can skip a day that is done. */
export const LEDGER_THINNED_UPSERT_SQL = `
  update readings_archive_days
     set thinned_tier = $3, thinned_rows = $4::bigint
   where day = $1::date and source = $2`;

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
