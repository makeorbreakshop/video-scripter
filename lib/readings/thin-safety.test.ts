// The thinning delete must not deadlock with live RSS ingestion, and must not push 9.4 M
// "the reading is gone" deltas through the Sep 11 event-driven queues.
//
// 2026-09-14 12:31 ET, manual thin run, exit 1 on the first day:
//
//   error: deadlock detected
//     PL/pgSQL function enqueue_observation_changes(jsonb) line 6 at SQL statement
//     PL/pgSQL function queue_rss_deletes() line 3 at PERFORM
//
// Two transactions wanted the same obs_cache_dirty / score_dirty / series_dirty rows in
// different orders: the RSS writer reaches them in video_id order via its insert trigger, the
// thinning delete reached them in ctid (physical) order via its delete trigger.
import {
  thinBatchSql, THIN_SUPPRESS_DELTAS_SQL, thinTransactionPreamble,
} from './sql';
import { isRetryableLockError, retryDelaysMs } from './thin-safety';

describe('thinBatchSql locks rows in the writers’ order', () => {
  for (const source of ['rss', 'api'] as const) {
    for (const bucket of ['hour', 'day'] as const) {
      const sql = thinBatchSql(source, bucket);
      const ts = source === 'rss' ? 'at' : 'sampled_at';

      it(`${source}/${bucket}: identifies the rows to delete by the primary key, not by ctid`, () => {
        // (video_id, at) and (video_id, sampled_at) are the primary keys, so they identify a row
        // exactly — and unlike ctid they have an order the writers also take their locks in.
        // `ctid` may still appear as a tie-break INSIDE the window functions (it orders rows that
        // share a timestamp); what must not survive is the delete keying on physical position.
        const del = sql.slice(sql.lastIndexOf('delete from'));
        expect(del).not.toMatch(/\bctid\b/);
        expect(del).toMatch(new RegExp(`s\\.video_id = d\\.video_id[\\s\\S]*s\\.${ts} = d\\.${ts}`));
        // and the doomed set itself is projected as the key, not the ctid
        expect(sql).toMatch(new RegExp(`with doomed as \\(\\s*select video_id, ${ts}`));
      });

      it(`${source}/${bucket}: orders the doomed set by (video_id, ${ts})`, () => {
        expect(sql).toMatch(new RegExp(`order by\\s+video_id[^\\n]*,\\s*${ts}`));
      });
    }
  }
});

describe('the delta-suppression flag', () => {
  it('is a session GUC the trigger reads, not a DDL trigger disable', () => {
    // `alter table rss_samples disable trigger` needs ACCESS EXCLUSIVE on a 2.2 GB table that
    // the RSS poller writes to every few minutes. It would block every live writer for the whole
    // thinning run. A `set local` GUC is transaction-scoped, needs no lock, and is the one form
    // the :6543 transaction pooler honours.
    expect(THIN_SUPPRESS_DELTAS_SQL).toMatch(/set local/i);
    expect(THIN_SUPPRESS_DELTAS_SQL).toMatch(/channelsmith\.suppress_observation_deltas/);
    expect(THIN_SUPPRESS_DELTAS_SQL).not.toMatch(/disable trigger/i);
    expect(THIN_SUPPRESS_DELTAS_SQL).not.toMatch(/alter table/i);
  });

  it('the preamble opens a transaction, bounds the lock wait, and suppresses deltas', () => {
    const sql = thinTransactionPreamble(60_000, 5_000);
    expect(sql).toMatch(/^begin;/);
    expect(sql).toMatch(/set local statement_timeout = 60000/);
    expect(sql).toMatch(/set local lock_timeout = 5000/);
    expect(sql).toMatch(/channelsmith\.suppress_observation_deltas/);
  });

  it('bounds the lock wait so a blocked batch gives way instead of piling up', () => {
    // Without lock_timeout a thinning batch waits behind a live writer for statement_timeout
    // (600 s), holding its own locks the whole time and widening the deadlock window.
    expect(thinTransactionPreamble(600_000, 5_000)).toMatch(/set local lock_timeout = 5000/);
  });
});

describe('retry policy', () => {
  it('retries a deadlock (40P01)', () => {
    expect(isRetryableLockError({ code: '40P01' })).toBe(true);
  });

  it('retries a lock_timeout (55P03) and a serialization failure (40001)', () => {
    expect(isRetryableLockError({ code: '55P03' })).toBe(true);
    expect(isRetryableLockError({ code: '40001' })).toBe(true);
  });

  it('does NOT retry anything else — a real error must surface', () => {
    expect(isRetryableLockError({ code: '42P01' })).toBe(false);
    expect(isRetryableLockError({ code: '57014' })).toBe(false); // statement_timeout
    expect(isRetryableLockError(new Error('boom'))).toBe(false);
    expect(isRetryableLockError(null)).toBe(false);
  });

  it('backs off, and gives up after a bounded number of attempts', () => {
    const d = retryDelaysMs();
    expect(d.length).toBeGreaterThanOrEqual(3);
    expect(d.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
    expect(d[d.length - 1]).toBeLessThanOrEqual(30_000);
  });
});

// ---- the cursor, which was the actual cost of a thinning run ---------------------------
//
// EXPLAIN (analyze, buffers) of nextVideosSql on rss 2026-09-05, 2026-09-14:
//
//   Limit … Buffers: shared hit=1605899 … actual time=1195.781
//     -> Finalize HashAggregate … rows=98947
//       -> Parallel Index Scan using idx_rss_samples_at … rows=861619 loops=2
//
// It HashAggregates the whole day — 1.7 M rows, 1.6 GB of buffer traffic, 1.2 s — and then
// returns the next 52 video ids. Once per batch. With 98,947 distinct videos in the day that is
// 1,903 batches × 1.2 s = 38 minutes of cursor scanning per day, before a single row is deleted.
// The day's distinct video ids are ~1.1 MB; read them once and slice them in memory.
import { dayVideosSql } from './sql';
import { chunk } from './thin-safety';

describe('the day cursor is read once, not once per batch', () => {
  it('dayVideosSql takes only the day — no cursor, no limit', () => {
    const sql = dayVideosSql('rss');
    expect(sql).toMatch(/group by video_id/);
    expect(sql).toMatch(/order by video_id collate "C"/);
    expect(sql).not.toMatch(/\blimit\b/i);
    expect(sql).not.toMatch(/\$2/); // no cursor parameter — there is only one call
    expect(sql).toMatch(/\$1::date/);
  });

  it('chunk() slices the ids into whole-video batches', () => {
    expect(chunk(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('chunk() preserves order, so the walk is still monotonic in video_id', () => {
    const ids = Array.from({ length: 500 }, (_, i) => `v${String(i).padStart(4, '0')}`);
    expect(chunk(ids, 52).flat()).toEqual(ids);
  });

  it('chunk() never emits an empty batch and never exceeds the size', () => {
    for (const n of [1, 7, 52, 999]) {
      for (const b of chunk(Array.from({ length: 200 }, (_, i) => `${i}`), n)) {
        expect(b.length).toBeGreaterThan(0);
        expect(b.length).toBeLessThanOrEqual(n);
      }
    }
  });

  it('chunk() rejects a nonsense batch size rather than looping forever', () => {
    expect(() => chunk(['a'], 0)).toThrow();
    expect(() => chunk(['a'], -1)).toThrow();
  });
});
