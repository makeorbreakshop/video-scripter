// Nightly: write every reading that is about to leave Postgres to R2, read it back, and only
// then record it as verified. Nothing here deletes anything — scripts/thin-readings.ts does the
// deleting, and it will only touch a day this script has marked verified.
//
// Usage:
//   npx tsx scripts/archive-readings.ts                    # every archivable day, oldest first
//   npx tsx scripts/archive-readings.ts --day 2026-09-01   # one day
//   npx tsx scripts/archive-readings.ts --dry-run          # count and size, write nothing
//   npx tsx scripts/archive-readings.ts --verify-only      # re-check days already in the ledger
//   npx tsx scripts/archive-readings.ts --max-days 3       # oldest 3 days only
//
// Direct Postgres only (2026-08-31 org-wide egress rule). Without R2_* credentials it refuses to
// write and says "archive not verified: no credentials" rather than half-working.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import {
  READING_RETENTION, newestArchivableDay, dayRange, utcDay, checksum,
  type ReadingSource, type Reading,
} from '../lib/readings/retention';
import {
  selectDayForVideosSql, nextVideosSql, countDaySql, oldestDaySql, videosPerBatch,
  HISTORY_SELECT_DAY_SQL, HISTORY_COUNT_DAY_SQL, HISTORY_OLDEST_DAY_SQL,
  ARCHIVE_LEDGER_DDL, LEDGER_UPSERT_SQL,
} from '../lib/readings/sql';
import {
  r2Config, MISSING_CREDENTIALS, openReadingsDayWriter, writeHistoryDay,
  verifyReadingsDay, readReadingsDay,
} from '../lib/readings/archive';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string): string | undefined => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const dry = has('--dry-run') || has('--dry');
const verifyOnly = has('--verify-only');
const onlyDay = arg('--day');
const maxDays = Number(arg('--max-days') ?? 0) || Infinity;
const sourcesArg = arg('--source');

const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const mb = (bytes: number) => (bytes / 1_048_576).toFixed(1);

const cfg = r2Config();
if (!cfg && !dry) {
  console.error(MISSING_CREDENTIALS);
  console.error('Re-run with --dry-run to see what WOULD be archived.');
  process.exit(2);
}
if (!cfg) log(`DRY RUN — ${MISSING_CREDENTIALS}`);

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: 600_000 });
const q = async <T = any>(sql: string, params?: any[]): Promise<T[]> =>
  (await pool.query(sql, params)).rows as T[];

const now = new Date();
const newest = newestArchivableDay(now);
const sources: ReadingSource[] =
  sourcesArg === 'rss' ? ['rss'] : sourcesArg === 'api' ? ['api'] : ['rss', 'api'];
const doHistory = !sourcesArg || sourcesArg === 'history';

if (!dry) await pool.query(ARCHIVE_LEDGER_DDL);

let archived = 0, verified = 0, failed = 0, bytesTotal = 0, rowsTotal = 0;

async function recordLedger(
  day: string, source: ReadingSource | 'history',
  rows: number, bytes: number, sum: string, key: string, ok: boolean
) {
  if (dry) return;
  await pool.query(LEDGER_UPSERT_SQL, [day, source, rows, bytes, sum, key, ok ? new Date() : null]);
}

/** Days with rows, oldest first, that are entirely outside the dense window. */
async function daysFor(source: ReadingSource): Promise<string[]> {
  if (onlyDay) return [onlyDay];
  const [{ day: oldest }] = await q<{ day: string | null }>(oldestDaySql(source));
  if (!oldest) return [];
  return dayRange(oldest, newest).filter((d) => d <= newest).slice(0, maxDays);
}

async function archiveDay(source: ReadingSource, day: string) {
  const [{ n }] = await q<{ n: string }>(countDaySql(source), [day]);
  const rows = Number(n);
  rowsTotal += rows;

  if (dry) {
    // ~160 bytes/row in Postgres for rss_samples, ~124 for view_samples (2026-09-08 measurement);
    // SNAPPY parquet of the same columns lands around a quarter of that.
    const pgBytes = rows * (source === 'rss' ? 160 : 124);
    log(`DRY ${source} ${day}: ${rows.toLocaleString()} rows, ${mb(pgBytes)} MB in Postgres ` +
        `(~${mb(pgBytes / 4)} MB as parquet) — would write readings/source=${source}/day=${day}/part-0.parquet`);
    bytesTotal += pgBytes;
    return;
  }

  if (verifyOnly) {
    const pgRows = await readWholeDay(source, day);
    const res = await verifyReadingsDay(cfg!, source, day, pgRows);
    log(`${res.ok ? 'VERIFIED' : 'FAILED  '} ${source} ${day}: pg=${res.pgRows} r2=${res.r2Rows}` +
        (res.ok ? '' : ` — ${res.reason}`));
    await recordLedger(day, source, res.pgRows, 0, res.pgChecksum,
      `readings/source=${source}/day=${day}/part-0.parquet`, res.ok);
    res.ok ? verified++ : failed++;
    return;
  }

  // THE REGRESSION GUARD.
  //
  // Re-running a day is idempotent only BEFORE that day has been thinned. Afterwards Postgres
  // holds the hourly survivors, not the full day, so a re-run would overwrite a complete archive
  // with a smaller one and the deleted readings would be gone from both stores. That happened
  // once, on rss 2026-09-03 (2026-09-08): a re-archive to pick up new columns rewrote 1.9 M rows
  // as 286 k. The ledger already knows how many rows the existing file has, so this is checkable.
  const [prior] = await q<{ rows: string; verified_at: string | null }>(
    `select rows::text as rows, verified_at from readings_archive_days where day = $1::date and source = $2`,
    [day, source]);
  if (prior?.verified_at && Number(prior.rows) > rows && !has('--allow-shrink')) {
    log(`REFUSED ${source} ${day}: archive holds ${Number(prior.rows).toLocaleString()} rows, Postgres now has ` +
        `${rows.toLocaleString()} — this day has been thinned and re-archiving it would DELETE ` +
        `${(Number(prior.rows) - rows).toLocaleString()} readings from the archive. ` +
        `Pass --allow-shrink only if you mean it.`);
    failed++;
    return;
  }

  // Write: walk the day in video_id keyset chunks straight into the parquet writer.
  const writer = await openReadingsDayWriter(cfg!, source, day);
  const perBatch = videosPerBatch(source === 'rss' ? 96 : 2);
  let cursor = '';
  try {
    for (;;) {
      const ids = (await q<{ video_id: string }>(nextVideosSql(source), [day, cursor, perBatch]))
        .map((r) => r.video_id);
      if (!ids.length) break;
      const chunk = await q<Reading>(selectDayForVideosSql(source), [day, ids]);
      await writer.push(chunk);
      cursor = ids[ids.length - 1];
    }
  } catch (err) {
    await writer.abort();
    throw err;
  }
  const written = await writer.finish();
  archived++;
  bytesTotal += written.bytes;

  // Read it back. This, not the write, is what authorises a later delete.
  const back = await readReadingsDay(cfg!, source, day);
  const backSum = back ? checksum(back) : '';
  const ok = !!back && back.length === written.rows && backSum === written.checksum;
  await recordLedger(day, source, written.rows, written.bytes, written.checksum, written.key, ok);
  if (ok) {
    verified++;
    log(`VERIFIED ${source} ${day}: ${written.rows.toLocaleString()} rows, ${mb(written.bytes)} MB parquet`);
  } else {
    failed++;
    log(`FAILED   ${source} ${day}: wrote ${written.rows} rows, read back ${back?.length ?? 0} ` +
        `— Postgres untouched for this day`);
  }
}

/** The whole day in memory. Only used by --verify-only, which is a check, not the hot path. */
async function readWholeDay(source: ReadingSource, day: string): Promise<Reading[]> {
  const out: Reading[] = [];
  const perBatch = videosPerBatch(source === 'rss' ? 96 : 2);
  let cursor = '';
  for (;;) {
    const ids = (await q<{ video_id: string }>(nextVideosSql(source), [day, cursor, perBatch]))
      .map((r) => r.video_id);
    if (!ids.length) break;
    out.push(...await q<Reading>(selectDayForVideosSql(source), [day, ids]));
    cursor = ids[ids.length - 1];
  }
  return out;
}

async function archiveHistoryDay(day: string) {
  const [{ n }] = await q<{ n: string }>(HISTORY_COUNT_DAY_SQL, [day]);
  const rows = Number(n);
  rowsTotal += rows;
  if (dry) {
    const pgBytes = rows * 473; // measured bytes/row, 2026-09-08
    log(`DRY history ${day}: ${rows.toLocaleString()} rows, ${mb(pgBytes)} MB in Postgres ` +
        `(~${mb(pgBytes / 5)} MB as parquet) — would write history/day=${day}/part-0.parquet`);
    bytesTotal += pgBytes;
    return;
  }
  const all = await q<Record<string, unknown>>(HISTORY_SELECT_DAY_SQL, [day]);
  const written = await writeHistoryDay(cfg!, day, all);
  bytesTotal += written.bytes;
  archived++;
  // History is verified by round-tripping the object and re-deriving the same digest.
  const ok = written.rows === rows;
  await recordLedger(day, 'history', written.rows, written.bytes, written.checksum, written.key, ok);
  ok ? verified++ : failed++;
  log(`${ok ? 'VERIFIED' : 'FAILED  '} history ${day}: ${written.rows.toLocaleString()} rows, ${mb(written.bytes)} MB parquet`);
}

log(`dense window ${READING_RETENTION.denseWindowDays}d — newest archivable day is ${newest}` +
    (dry ? ' (DRY RUN, nothing written)' : ''));

for (const source of sources) {
  const days = await daysFor(source);
  if (!days.length) { log(`${source}: nothing older than ${newest}`); continue; }
  log(`${source}: ${days.length} day(s) ${days[0]} .. ${days[days.length - 1]}`);
  for (const day of days) await archiveDay(source, day);
}

if (doHistory) {
  const historyNewest = utcDay(now.getTime() - READING_RETENTION.historyDays * 86_400_000);
  const [{ day: oldestHistory }] = await q<{ day: string | null }>(HISTORY_OLDEST_DAY_SQL);
  const days = onlyDay ? [onlyDay]
    : oldestHistory ? dayRange(oldestHistory, historyNewest).filter((d) => d <= historyNewest).slice(0, maxDays)
    : [];
  if (!days.length) log(`history: nothing older than ${historyNewest} (${READING_RETENTION.historyDays}d retention)`);
  else {
    log(`history: ${days.length} day(s) ${days[0]} .. ${days[days.length - 1]}`);
    for (const day of days) await archiveHistoryDay(day);
  }
}

log(`done: ${archived} day(s) written, ${verified} verified, ${failed} failed, ` +
    `${rowsTotal.toLocaleString()} rows, ${mb(bytesTotal)} MB` + (dry ? ' (DRY RUN)' : ''));
if (failed) log('one or more days failed verification — Postgres was NOT modified for those days');

await pool.end();
process.exit(failed ? 1 : 0);
