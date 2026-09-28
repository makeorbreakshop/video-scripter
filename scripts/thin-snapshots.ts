// Thin view_snapshots to the retention policy (lib/readings/snapshot-retention.ts), archive-first.
//
// For each snapshot_date older than the protection window, oldest first:
//   1. if the ledger does not already hold a verified archive of the day at its current row count,
//      read the day, write snapshots/day=YYYY-MM-DD/part-0.parquet to R2, read it back and compare
//      row count + checksum (lib/readings/archive.ts archiveSnapshotDay). No match → no delete.
//   2. delete the rows the policy does not keep (snapshotThinDaySql), in one transaction with the
//      observation-delta triggers suppressed (a thinned snapshot is not a correction) and a
//      lock_timeout, then record the tier and the rows left, so the day is not walked again.
//
// Egress: step 1 returns the day's rows once (~20 K rows × ~130 B ≈ 2.6 MB per day, ~90 days of
// backlog ≈ 230 MB once, then ~51 K rows/day ≈ 7 MB/day). Step 2 returns nothing.
//
// Usage:
//   npx tsx scripts/thin-snapshots.ts --dry-run
//   npx tsx scripts/thin-snapshots.ts --max-days 30      # nightly, from archive-then-thin.sh
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import { r2Config, archiveSnapshotDay } from '../lib/readings/archive';
import {
  snapshotThinDaySql, SNAPSHOT_DAY_SELECT_SQL, SNAPSHOT_DAY_COUNT_SQL, SNAPSHOT_DAYS_SQL, type ArchivedSnapshot,
} from '../lib/readings/snapshot-retention';
import { LEDGER_SELECT_SQL, LEDGER_UPSERT_SQL, LEDGER_THINNED_UPSERT_SQL, THIN_SUPPRESS_DELTAS_SQL } from '../lib/readings/sql';
import type { LedgerRow } from '../lib/readings/chain';
import { recordOutcome } from '../lib/ops/job-outcomes';

const args = process.argv.slice(2);
const arg = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const dry = args.includes('--dry-run');
const maxDays = Number(arg('--max-days') ?? 30);
const TIER = 'snap-v1';
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 1, timeoutMs: 120_000 });
const q = async <T = any>(sql: string, params?: any[]): Promise<T[]> => (await pool.query(sql, params)).rows as T[];
const cfg = r2Config();

let deleted = 0, archived = 0, skipped = 0, failed = 0, bytesRead = 0;
try {
  if (!cfg && !dry) throw new Error('no R2 credentials: nothing may be deleted without a verified archive');
  const ledger = (await q<LedgerRow>(LEDGER_SELECT_SQL)).filter((r) => r.source === ('snapshots' as never));
  const days = (await q<{ day: string }>(SNAPSHOT_DAYS_SQL)).map((r) => r.day);
  let done = 0;
  for (const day of days) {
    if (done >= maxDays) break;
    const n = Number((await q<{ n: string }>(SNAPSHOT_DAY_COUNT_SQL, [day]))[0].n);
    const row = ledger.find((r) => r.day === day);
    if (row && row.thinned_tier === (TIER as never) && Number(row.thinned_rows) === n) continue;
    done++;
    const verified = !!row?.verified_at && Number(row.rows) === n;
    if (dry) { log(`DRY snapshots ${day}: ${n.toLocaleString()} rows${verified ? ' (archive verified)' : ' — would archive first'}`); continue; }
    if (!verified) {
      const rows = await q<ArchivedSnapshot>(SNAPSHOT_DAY_SELECT_SQL, [day]);
      bytesRead += rows.length * 130;
      const w = await archiveSnapshotDay(cfg!, day, rows);
      await pool.query(LEDGER_UPSERT_SQL, [day, 'snapshots', w.rows, w.bytes, w.checksum, w.key, w.ok ? new Date() : null]);
      if (!w.ok) { failed++; log(`FAILED snapshots ${day}: R2 read-back did not match; nothing deleted`); continue; }
      archived++;
    }
    // One transaction: suppress the deltas, bound the lock wait, delete, commit.
    const c = await pool.connect();
    let gone = 0;
    try {
      await c.query(`begin; set local statement_timeout = 120000; set local lock_timeout = 5000; ${THIN_SUPPRESS_DELTAS_SQL}`);
      gone = (await c.query(snapshotThinDaySql(), [day])).rowCount ?? 0;
      await c.query('commit');
    } catch (err) {
      await c.query('rollback').catch(() => {});
      failed++;
      log(`FAILED snapshots ${day}: ${(err as Error).message}`);
      continue;
    } finally { c.release(); }
    deleted += gone;
    await pool.query(LEDGER_THINNED_UPSERT_SQL, [day, 'snapshots', TIER, n - gone]);
    log(`THINNED snapshots ${day}: ${n.toLocaleString()} → ${(n - gone).toLocaleString()} (−${gone.toLocaleString()})`);
  }
  if (!done) { skipped++; log('snapshots: every day older than the protection window is at its tier'); }
  const detail = `${deleted} rows deleted, ${archived} day(s) archived, ${failed} failed; ~${(bytesRead / 1e6).toFixed(1)} MB read`;
  log(`done: ${detail}${dry ? ' (DRY RUN)' : ''}`);
  if (!dry) recordOutcome({ job: 'thin-snapshots', status: failed ? 'failed' : deleted ? 'progressed' : 'idle',
                            progressed: deleted, backlog: failed, detail });
  if (failed) process.exitCode = 1;
} catch (err) {
  console.error(err);
  if (!dry) recordOutcome({ job: 'thin-snapshots', status: 'failed', progressed: deleted, backlog: null, detail: (err as Error).message });
  process.exitCode = 1;
} finally {
  await pool.end();
}
