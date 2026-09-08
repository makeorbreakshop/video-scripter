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
  thinBatchSql, nextVideosSql, countDaySql, oldestDaySql, videosPerBatch,
  HISTORY_DELETE_BATCH_SQL, HISTORY_COUNT_DAY_SQL, HISTORY_OLDEST_DAY_SQL,
  ARCHIVE_LEDGER_DDL, LEDGER_SELECT_SQL,
} from '../lib/readings/sql';

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
const ledger = await q<ArchivedDay>(LEDGER_SELECT_SQL);
log(`ledger: ${ledger.length} archived day(s), ${ledger.filter((d) => d.verified_at).length} verified`);

const now = new Date();
const newest = newestArchivableDay(now);
let deletedTotal = 0, skipped = 0;

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
  if (!isThinnable(day, source, ledger)) {
    skipped++;
    log(`SKIP ${source} ${day}: not verified in R2 — run scripts/archive-readings.ts --day ${day} first`);
    return;
  }
  // The tier is decided from the day's own end, so a day only ever moves dense → hourly → daily.
  const tier = tierOf(Date.parse(`${day}T23:59:59.999Z`), now);
  if (tier === 'dense') return;
  const bucket = tier === 'hourly' ? 'hour' : 'day';

  const [{ n: beforeN }] = await q<{ n: string }>(countDaySql(source), [day]);
  const before = Number(beforeN);
  if (!before) return;

  if (dry) {
    log(`DRY ${source} ${day} (${tier}): ${before.toLocaleString()} rows present, verified in R2 — would thin to one per video per ${bucket}`);
    return;
  }

  const perBatch = videosPerBatch(source === 'rss' ? 96 : 2);
  const sql = thinBatchSql(source, bucket);
  let cursor = '', deleted = 0;
  for (;;) {
    // Whole videos per batch: thinning half a video's readings would let the window function
    // pick the "last reading of the hour" out of half the evidence and delete the real one.
    const ids = (await q<{ video_id: string }>(nextVideosSql(source), [day, cursor, perBatch]))
      .map((r) => r.video_id);
    if (!ids.length) break;
    const res = await pool.query(sql, [day, ids]);
    deleted += res.rowCount ?? 0;
    cursor = ids[ids.length - 1];
  }
  deletedTotal += deleted;
  const [{ n: afterN }] = await q<{ n: string }>(countDaySql(source), [day]);
  log(`THINNED ${source} ${day} (${tier}): ${before.toLocaleString()} → ${Number(afterN).toLocaleString()} rows (−${deleted.toLocaleString()})`);
}

for (const source of ['rss', 'api'] as ReadingSource[]) {
  const [{ day: oldest }] = await q<{ day: string | null }>(oldestDaySql(source));
  if (!oldest) { log(`${source}: table is empty`); continue; }
  const days = candidateDays(oldest).slice(0, maxDays);
  if (!days.length) { log(`${source}: nothing outside the ${READING_RETENTION.denseWindowDays}-day dense window`); continue; }
  for (const day of days) await thinDay(source, day);
}

// ---- video_score_history: no tiers, just an expiry. Nothing reads it (2026-09-08 audit).
const historyNewest = utcDay(now.getTime() - READING_RETENTION.historyDays * 86_400_000);
const [{ day: oldestHistory }] = await q<{ day: string | null }>(HISTORY_OLDEST_DAY_SQL);
if (!oldestHistory) {
  log('history: table is empty');
} else {
  const days = (onlyDay ? [onlyDay] : dayRange(oldestHistory, historyNewest))
    .filter((d) => d <= historyNewest).slice(0, maxDays);
  if (!days.length) log(`history: nothing older than ${historyNewest}`);
  for (const day of days) {
    if (!isThinnable(day, 'history', ledger)) {
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

log(`done: ${deletedTotal.toLocaleString()} rows deleted, ${skipped} day(s) skipped for lack of a verified archive` +
    (dry ? ' (DRY RUN, nothing deleted)' : ''));
await pool.end();
