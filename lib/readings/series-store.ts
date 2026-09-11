// Reading, writing and invalidating the per-video series files on R2.
//
// THE WRITE PATH IS A QUEUE, NOT A PUT.
//
// Five code paths ingest readings (lib/rss/response-store.ts saveRssObservations,
// lib/nightly/sample-batch.ts writeSampleBatch, lib/ingest/first-sample.ts ingestWrites and its
// callers). A single RSS tick can touch 5,000 videos. Rebuilding a series file inline would be
// 5,000 R2 GETs, 5,000 rebuilds and 5,000 PUTs on the critical path of the poller, and a failed
// PUT would have to either lose the reading or fail the tick.
//
// So the writers do one thing, in the transaction that already exists: mark the videos dirty.
// That is a single statement over an unnest(), inserting into a narrow table with a primary key
// on video_id, so a tick with 5,000 readings is ONE statement and at most 5,000 tiny rows —
// and re-marking an already-dirty video only advances its generation. `scripts/rebuild-series.ts`
// drains the queue on a schedule, one R2 PUT per distinct video per drain however many readings
// landed. The exact-generation clear preserves a mark that arrives during an R2 write.
//
// Marking dirty must never break ingestion: markSeriesDirty swallows its own errors and reports
// how many it marked. A missed mark costs a stale series file, which the page detects and falls
// back from; a thrown mark would cost the reading itself.

import { r2Config, getObject, putObject, type R2Config } from './archive';
import { seriesKey, encodeSeries, decodeSeries, SERIES_CONTENT_TYPE, type VideoSeriesFile } from './series';

export const SERIES_DIRTY_DDL = `
  /* trace:series.queue-ddl */
  create sequence if not exists pipeline_generation_seq;
  create table if not exists series_dirty (
    video_id   text primary key,
    marked_at  timestamptz not null default now(),
    attempts   int not null default 0,
    generation bigint not null default 0
  );
  alter table series_dirty add column if not exists generation bigint not null default 0`;

/** One statement, any number of videos, idempotent. $1 = video_id[]. */
export const SERIES_DIRTY_MARK_SQL = `
  insert into series_dirty (video_id, marked_at, generation) /* trace:series.queue-mark */
  select v, now(), nextval('pipeline_generation_seq') from unnest($1::text[]) as v
  where v is not null and v <> ''
  on conflict (video_id) do update set
    marked_at = excluded.marked_at, generation = excluded.generation`;

/** The next batch to rebuild, oldest mark first. $1 = limit. */
export const SERIES_DIRTY_CLAIM_SQL = `
  /* trace:series.queue-claim */
  select video_id, generation from series_dirty order by marked_at, video_id limit $1`;

export const SERIES_DIRTY_CLEAR_SQL = `
  /* trace:series.queue-clear */
  delete from series_dirty d using jsonb_to_recordset($1::jsonb) as x(video_id text, generation bigint)
   where d.video_id = x.video_id and d.generation = x.generation`;

export const SERIES_DIRTY_FAIL_SQL =
  `update series_dirty set attempts = attempts + 1, marked_at = now() where video_id = any($1::text[])`;

export const SERIES_DIRTY_COUNT_SQL = `/* trace:series.queue-count */ select count(*)::bigint as n from series_dirty`;

export type SeriesTargetDisposition = 'build' | 'retire-legacy' | 'wait-for-state';

/**
 * Generation zero is the queue imported at cutover, before event-driven observation state
 * existed. A miss there cannot become buildable without rereading raw history, so retire the
 * obsolete derived-work mark. Every post-cutover mark has a sequence generation and must remain
 * queued until its matching materialized state arrives.
 */
export function seriesTargetDisposition(
  generation: number | undefined,
  hasMaterializedState: boolean,
): SeriesTargetDisposition {
  if (hasMaterializedState) return 'build';
  return generation === 0 ? 'retire-legacy' : 'wait-for-state';
}

/** Anything that can run a parameterised statement: a Pool, a checked-out client, or the
 *  narrower BatchClient the nightly batch writer passes. */
export interface Queryable { query(sql: string, values?: any[]): Promise<any> }

/**
 * Mark videos for a series rebuild. Never throws — see the header. Returns the number of ids it
 * attempted, or 0 if the mark failed, so a caller can log a drift it cannot fix.
 *
 * `transactional` is not optional politeness. Two of the callers run inside an open transaction
 * that is about to commit real readings (lib/rss/response-store.ts saveRssObservations,
 * lib/nightly/sample-batch.ts writeSampleBatch). In Postgres ANY failed statement aborts the
 * whole transaction, so a mark that failed — the table not yet created, a lock timeout — would
 * turn the following `commit` into a rollback and LOSE THE READINGS this queue exists to serve.
 * The savepoint contains the failure: the mark is lost, the readings are not.
 */
export async function markSeriesDirty(
  db: Queryable, videoIds: readonly string[], opts: { transactional?: boolean } = {}
): Promise<number> {
  const ids = [...new Set(videoIds.filter(Boolean))];
  if (!ids.length) return 0;
  if (opts.transactional) {
    try {
      await db.query('savepoint series_dirty_mark');
    } catch {
      return 0;                                  // not in a transaction after all; do not risk it
    }
    try {
      await db.query(SERIES_DIRTY_MARK_SQL, [ids]);
      await db.query('release savepoint series_dirty_mark');
      return ids.length;
    } catch (e) {
      await db.query('rollback to savepoint series_dirty_mark').catch(() => {});
      await db.query('release savepoint series_dirty_mark').catch(() => {});
      console.warn(`[series] could not mark ${ids.length} videos dirty: ${(e as Error).message}`);
      return 0;
    }
  }
  try {
    await db.query(SERIES_DIRTY_MARK_SQL, [ids]);
    return ids.length;
  } catch (e) {
    console.warn(`[series] could not mark ${ids.length} videos dirty: ${(e as Error).message}`);
    return 0;
  }
}

// ---- R2 ---------------------------------------------------------------------------------

/** null for "not there / unreadable / no credentials" — every one of those is a cache miss. */
export async function readSeriesFile(
  videoId: string, cfg: R2Config | null = r2Config()
): Promise<VideoSeriesFile | null> {
  if (!cfg) return null;
  try {
    const buf = await getObject(cfg, seriesKey(videoId));
    return buf ? decodeSeries(buf) : null;
  } catch { return null; }
}

export async function writeSeriesFile(
  file: VideoSeriesFile, cfg: R2Config | null = r2Config()
): Promise<{ key: string; bytes: number }> {
  if (!cfg) throw new Error('series: no R2 credentials');
  const body = encodeSeries(file);
  const key = seriesKey(file.video_id);
  await putObject(cfg, key, body, SERIES_CONTENT_TYPE);
  return { key, bytes: body.length };
}

// ---- the fallback counter ----------------------------------------------------------------

/**
 * Every series read is counted, so the fallback rate is a number we can read off the logs rather
 * than a feeling. `[series] hit|miss` lines are one per page render; the totals are for a process
 * that renders many (the equality test, a load run).
 */
export const seriesReads = { hits: 0, misses: 0 };

export function noteSeriesRead(videoId: string, file: VideoSeriesFile | null, reason = ''): void {
  if (file) {
    seriesReads.hits++;
    return;
  }
  seriesReads.misses++;
  const rate = seriesReads.misses / (seriesReads.hits + seriesReads.misses);
  console.warn(`[series] fallback to postgres video=${videoId}${reason ? ` reason=${reason}` : ''} rate=${(rate * 100).toFixed(1)}%`);
}

export function seriesFallbackRate(): number {
  const n = seriesReads.hits + seriesReads.misses;
  return n ? seriesReads.misses / n : 0;
}

// ---- building one from Postgres ------------------------------------------------------------

/**
 * The five reads that make a series file. Deliberately the SAME predicates the page's own query
 * uses (lib/admin/queries.ts videoPage) EXCEPT that rss is unfiltered — the file keeps the flags
 * and seriesRss() applies the predicate, so one file serves both the page and the scorer.
 */
export const SERIES_SQL = {
  video: `/* trace:series.video-read */ select id, published_at from videos where id = any($1::text[])`,
  snapshots: `select video_id, (snapshot_date::timestamptz + interval '12 hours') as at, created_at,
                     view_count as views, days_since_published, like_count, comment_count
                from view_snapshots where video_id = any($1::text[]) order by video_id, snapshot_date`,
  samples: `select video_id, sampled_at as at, view_count as views
              from view_samples where video_id = any($1::text[]) order by video_id, sampled_at`,
  rss: `select video_id, at, views, time_basis, received_at, model_eligible, conflicted
          from rss_samples where video_id = any($1::text[]) order by video_id, at`,
  thumbs: `/* trace:series.thumbnail-read */
           select video_id, version, first_seen, last_checked, sha256, phash, r2_uploaded_at
             from thumbnail_versions where video_id = any($1::text[]) order by video_id, version`,
  titles: `/* trace:series.title-read */ select video_id, version, title, first_seen
             from title_versions where video_id = any($1::text[]) order by video_id, version`,
} as const;

/**
 * The mark as a `{ sql, params }` pair, for the callers that collect writes rather than run
 * them (lib/ingest/first-sample.ts ingestWrites and its three loops). Same statement, so there
 * is one definition of "mark dirty" in the codebase.
 */
export function seriesDirtyWrite(videoIds: readonly string[]): { sql: string; params: any[] } | null {
  const ids = [...new Set(videoIds.filter(Boolean))];
  return ids.length ? { sql: SERIES_DIRTY_MARK_SQL, params: [ids] } : null;
}
