// Thin Postgres down to the serving resolution, and ONLY where R2 already holds the raw day.
//
//   age < 7d      untouched
//   7 .. 30d      one reading per video per UTC hour
//   > 30d         one reading per video per UTC day
//   history       video_score_history older than 14 days is deleted outright
//
// Every day is checked against readings_archive_days first (lib/readings/retention.ts
// assertThinnable). A day that is not written, read back and matched in R2 is skipped with a
// message; the disk stays full rather than the data going away.
//
// Usage:
//   npx tsx scripts/thin-readings.ts --dry-run
//   npx tsx scripts/thin-readings.ts --max-days 3
//   npx tsx scripts/thin-readings.ts --all      # re-walk every archived day, not just the window
//
// Direct Postgres only (2026-08-31 org-wide egress rule).
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import {
  READING_RETENTION, newestArchivableDay, dayRange, utcDay, tierOf, isThinnable,
  type ArchivedDay, type ReadingSource,
} from '../lib/readings/retention';
import {
  thinBatchSql, dayVideosSql, countDaySql, oldestDaySql, videosPerBatch,
  thinTransactionPreamble,
  HISTORY_DELETE_BATCH_SQL, HISTORY_COUNT_DAY_SQL, HISTORY_OLDEST_DAY_SQL,
  ARCHIVE_LEDGER_DDL, ARCHIVE_LEDGER_THINNED_DDL, LEDGER_SELECT_SQL, LEDGER_THINNED_UPSERT_SQL,
} from '../lib/readings/sql';
import { decideThin, type LedgerRow, type ThinnedTier } from '../lib/readings/chain';
import { isRetryableLockError, retryDelaysMs, chunk } from '../lib/readings/thin-safety';
import { recordOutcome } from '../lib/ops/job-outcomes';
import {
  HISTORY, HISTORY_PARTITIONED_SQL, LIST_PARTITIONS_SQL, DEFAULT_PARTITION_ROWS_SQL,
  createPartitionSql, dropPartitionSql, partitionDays, planPartitions,
} from '../lib/readings/history-partitions';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const dry = has('--dry-run') || has('--dry');
const all = has('--all');
const onlyDay = arg('--day');
const maxDays = Number(arg('--max-days') ?? 0) || Infinity;

const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: 600_000 });
const q = async <T = any>(sql: string, params?: any[]): Promise<T[]> =>
  (await pool.query(sql, params)).rows as T[];

await pool.query(ARCHIVE_LEDGER_DDL);
await pool.query(ARCHIVE_LEDGER_THINNED_DDL);
const ledger = await q<LedgerRow>(LEDGER_SELECT_SQL);
log(`ledger: ${ledger.length} archived day(s), ${ledger.filter((d) => d.verified_at).length} verified`);

const now = new Date();
const newest = newestArchivableDay(now);
let deletedTotal = 0, skipped = 0, noop = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One thinning batch, in its own transaction, with the delete deltas suppressed.
 *
 * The 2026-09-14 deadlock was this statement against a live RSS insert, both reaching the same
 * obs_cache_dirty / score_dirty / series_dirty rows through the Sep 11 statement triggers. Three
 * things changed: the delete now takes rows in primary-key order (sql.ts thinBatchSql), the
 * delete deltas are suppressed because a thinned row is not a correction (sql.ts
 * THIN_SUPPRESS_DELTAS_SQL — the argument is in the runbook), and a bounded lock_timeout plus
 * this retry turns the contention that remains into a pause rather than a failed run.
 */
async function thinBatch(sql: string, day: string, ids: string[]): Promise<number> {
  const delays = retryDelaysMs();
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query(thinTransactionPreamble(600_000, READING_RETENTION.thinLockTimeoutMs));
      const res = await client.query(sql, [day, ids]);
      await client.query('commit');
      return res.rowCount ?? 0;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      if (!isRetryableLockError(err) || attempt >= delays.length) throw err;
      log(`  retry ${attempt + 1}/${delays.length} after ${(err as { code?: string }).code} ` +
          `(${ids.length} videos) — waiting ${delays[attempt]} ms`);
      await sleep(delays[attempt]);
    } finally {
      client.release();
    }
  }
}

/**
 * Days worth walking tonight. A day is thinned when it first leaves the dense window and again
 * when it crosses into the daily tier, so re-walking the whole archive every night is waste —
 * the hourly window plus a few days either side of the 30-day boundary covers both transitions.
 * `--all` walks everything, for a backfill or after a policy change.
 */
function candidateDays(oldest: string): string[] {
  const days = dayRange(oldest, newest);
  if (all || onlyDay) return onlyDay ? [onlyDay] : days;
  const hourlyStart = utcDay(now.getTime() - (READING_RETENTION.hourlyWindowDays + 3) * 86_400_000);
  return days.filter((d) => d >= hourlyStart);
}

async function thinDay(source: ReadingSource, day: string) {
  // The tier is decided from the day's own end, so a day only ever moves dense → hourly → daily.
  const tier = tierOf(Date.parse(`${day}T23:59:59.999Z`), now);
  if (tier === 'dense') return;
  const bucket: ThinnedTier = tier === 'hourly' ? 'hour' : 'day';

  const [{ n: beforeN }] = await q<{ n: string }>(countDaySql(source), [day]);
  const before = Number(beforeN);

  // THE RULE, and then the cost. lib/readings/chain.ts decideThin() owns both.
  const decision = decideThin(day, source, bucket, before, ledger);
  if (decision.action === 'skip') {
    if (decision.reason === 'unverified') {
      skipped++;
      log(`SKIP ${source} ${day}: not verified in R2 — run scripts/archive-readings.ts --day ${day} first`);
    } else if (decision.reason === 'already-thinned') {
      // `THINNED rss 2026-09-03 (hourly): 286,346 → 286,346 (−0)` cost 3.5 minutes of index
      // scans to discover that this day was thinned to the hourly tier six days ago.
      noop++;
      log(`SKIP ${source} ${day} (${tier}): already thinned to one per ${bucket}, ${before.toLocaleString()} rows unchanged`);
    }
    return;
  }

  if (dry) {
    log(`DRY ${source} ${day} (${tier}): ${before.toLocaleString()} rows present, verified in R2 — would thin to one per video per ${bucket}`);
    return;
  }

  // Smaller batches than the archive's: a thinning delete holds row locks on a table the RSS
  // poller is writing to, so the lock window is the thing being minimised, not round trips.
  const perBatch = videosPerBatch(source === 'rss' ? 96 : 2, READING_RETENTION.thinBatchRows);
  const sql = thinBatchSql(source, bucket);

  // ONE scan for the day's videos, then slice in memory. The keyset cursor this replaces
  // re-aggregated the entire day per batch — 1.6 GB of buffers and 1.2 s each, ~1,900 times per
  // day. See lib/readings/sql.ts dayVideosSql().
  const tCursor = Date.now();
  const videoIds = (await q<{ video_id: string }>(dayVideosSql(source), [day])).map((r) => r.video_id);
  const batches = chunk(videoIds, perBatch);
  log(`  ${source} ${day}: ${videoIds.length.toLocaleString()} videos in ${batches.length} batch(es), ` +
      `cursor scan ${Date.now() - tCursor} ms`);

  let deleted = 0, done = 0;
  for (const ids of batches) {
    // Whole videos per batch: thinning half a video's readings would let the window function
    // pick the "last reading of the hour" out of half the evidence and delete the real one.
    deleted += await thinBatch(sql, day, ids);
    if (++done % 100 === 0) {
      log(`  ${source} ${day}: ${done}/${batches.length} batches, ${deleted.toLocaleString()} deleted`);
    }
  }
  deletedTotal += deleted;
  const [{ n: afterN }] = await q<{ n: string }>(countDaySql(source), [day]);
  const after = Number(afterN);
  // Record where this day was left, so tomorrow night can skip it without walking it.
  await pool.query(LEDGER_THINNED_UPSERT_SQL, [day, source, bucket, after]);
  const row = ledger.find((d) => d.day === day && d.source === source);
  if (row) { row.thinned_tier = bucket; row.thinned_rows = after; }
  log(`THINNED ${source} ${day} (${tier}): ${before.toLocaleString()} → ${after.toLocaleString()} rows (−${deleted.toLocaleString()})`);
}

for (const source of ['rss', 'api'] as ReadingSource[]) {
  const [{ day: oldest }] = await q<{ day: string | null }>(oldestDaySql(source));
  if (!oldest) { log(`${source}: table is empty`); continue; }
  const days = candidateDays(oldest).slice(0, maxDays);
  if (!days.length) { log(`${source}: nothing outside the ${READING_RETENTION.denseWindowDays}-day dense window`); continue; }
  for (const day of days) await thinDay(source, day);
}

// ---- video_score_history: no tiers, just an expiry. Nothing reads it (2026-09-08 audit).
//
// Once the table is partitioned by day (sql/2026-09-26-partition-video-score-history.sql),
// retention is DROP of an archived day's partition — the only form that returns disk after a
// rescoring burst — and the next week of partitions is created ahead. Until then, DELETE.
const historyNewest = utcDay(now.getTime() - READING_RETENTION.historyDays * 86_400_000);
const [{ partitioned }] = await q<{ partitioned: boolean }>(HISTORY_PARTITIONED_SQL);
if (partitioned) {
  const existing = partitionDays((await q<{ relname: string }>(LIST_PARTITIONS_SQL)).map((r) => r.relname));
  const plan = planPartitions(existing, now, {
    keepDays: READING_RETENTION.historyDays, aheadDays: 7,
    isArchived: (d) => isThinnable(d, 'history', ledger as unknown as ArchivedDay[]),
  });
  for (const d of plan.create) {
    if (dry) { log(`DRY history: would create partition ${d}`); continue; }
    await pool.query(createPartitionSql(HISTORY, d));
    log(`history: created partition ${d}`);
  }
  for (const d of plan.blocked) { skipped++; log(`SKIP history ${d}: not verified in R2; partition kept`); }
  for (const d of plan.drop.slice(0, maxDays)) {
    const [{ n }] = await q<{ n: string }>(HISTORY_COUNT_DAY_SQL, [d]);
    if (dry) { log(`DRY history ${d}: would drop partition (${Number(n).toLocaleString()} rows, verified in R2)`); continue; }
    await pool.query(dropPartitionSql(HISTORY, d));
    deletedTotal += Number(n);
    log(`DROPPED history partition ${d}: ${Number(n).toLocaleString()} rows`);
  }
  const [{ n: stray }] = await q<{ n: number }>(DEFAULT_PARTITION_ROWS_SQL);
  if (stray) log(`WARNING history: ${stray} row(s) in video_score_history_default — a day arrived with no partition`);
} else {
  const [{ day: oldestHistory }] = await q<{ day: string | null }>(HISTORY_OLDEST_DAY_SQL);
  if (!oldestHistory) {
    log('history: table is empty');
  } else {
    const days = (onlyDay ? [onlyDay] : dayRange(oldestHistory, historyNewest))
      .filter((d) => d <= historyNewest).slice(0, maxDays);
    if (!days.length) log(`history: nothing older than ${historyNewest}`);
    for (const day of days) {
      if (!isThinnable(day, 'history', ledger as unknown as ArchivedDay[])) {
        skipped++;
        log(`SKIP history ${day}: not verified in R2`);
        continue;
      }
      const [{ n }] = await q<{ n: string }>(HISTORY_COUNT_DAY_SQL, [day]);
      const before = Number(n);
      if (!before) continue;
      if (dry) { log(`DRY history ${day}: ${before.toLocaleString()} rows, verified in R2 — would delete all`); continue; }
      let cursor = '0', deleted = 0;
      for (;;) {
        const res = await q<{ id: string }>(HISTORY_DELETE_BATCH_SQL, [day, cursor, READING_RETENTION.batchSize]);
        if (!res.length) break;
        deleted += res.length;
        cursor = res[res.length - 1].id;
        if (res.length < READING_RETENTION.batchSize) break;
      }
      deletedTotal += deleted;
      log(`DELETED history ${day}: ${deleted.toLocaleString()} rows`);
    }
  }
}

log(`done: ${deletedTotal.toLocaleString()} rows deleted, ${skipped} day(s) skipped for lack of a ` +
    `verified archive, ${noop} day(s) already at their tier` + (dry ? ' (DRY RUN, nothing deleted)' : ''));
// A night that skipped days for lack of a verified archive and deleted nothing is the shape of the
// 2026-09-08..14 incident (six nights of `archive && thin` never thinning): record it as a no-op
// with backlog, so scripts/storage-guard.ts alerts on the third in a row.
if (!dry) {
  recordOutcome({
    job: 'thin-readings',
    status: deletedTotal > 0 ? 'progressed' : skipped > 0 ? 'noop' : 'idle',
    progressed: deletedTotal,
    backlog: skipped,
    detail: `${deletedTotal} rows deleted, ${skipped} day(s) skipped (no verified archive), ${noop} already at tier`,
  });
}
await pool.end();
