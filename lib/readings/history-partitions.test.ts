import {
  partitionName, createPartitionSql, dropPartitionSql, partitionDays, planPartitions,
  partitionMigrationSql, HISTORY, LIST_PARTITIONS_SQL,
} from './history-partitions';
import fs from 'node:fs';
import path from 'node:path';

// WHY PARTITION (2026-09-26). video_score_history keeps 14 days; ~20 K rows/day is ~130 MB at
// steady state. But a full rescoring pass writes ~800 K rows in a day, and four of them
// (2026-09-02..12) left the heap at 1,280 MB — 92.7 % free space — because a DELETE never gives
// space back to the filesystem. With one partition per UTC day, retention is DROP TABLE: a burst
// occupies disk for exactly 14 days and then leaves, with no rewrite and no bloat.

describe('naming and bounds', () => {
  it('names a partition after its UTC day', () => {
    expect(partitionName(HISTORY, '2026-09-26')).toBe('public.video_score_history_p20260926');
  });

  it('bounds each partition to one UTC day, half-open', () => {
    const sql = createPartitionSql(HISTORY, '2026-09-26');
    expect(sql).toMatch(/set local lock_timeout = '5s'; create table if not exists public\.video_score_history_p20260926\s+partition of public\.video_score_history/);
    expect(sql).toMatch(/for values from \('2026-09-26 00:00:00\+00'\) to \('2026-09-27 00:00:00\+00'\)/);
  });

  it('drops with a lock_timeout, so a busy parent fails the night instead of queueing everyone', () => {
    const sql = dropPartitionSql(HISTORY, '2026-09-12');
    expect(sql).toMatch(/set local lock_timeout = '5s'/);
    expect(sql).toMatch(/drop table if exists public\.video_score_history_p20260912/);
    expect(sql).not.toMatch(/\bbegin\b|\bcommit\b/); // runs inside the pool's own transaction
  });

  it('rejects a malformed day rather than building SQL from it', () => {
    expect(() => createPartitionSql(HISTORY, "2026-09-26'); drop table x; --")).toThrow();
  });

  it('reads the day back out of a partition name', () => {
    expect(partitionDays(['video_score_history_p20260912', 'video_score_history_default', 'other']))
      .toEqual(['2026-09-12']);
  });
});

describe('the nightly plan', () => {
  const now = new Date('2026-09-26T07:00:00Z');

  it('creates the next week ahead, and drops only archived days past retention', () => {
    const existing = ['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-26', '2026-09-27'];
    const archived = new Set(['2026-09-11', '2026-09-12']);
    const p = planPartitions(existing, now, { keepDays: 14, aheadDays: 7, isArchived: (d) => archived.has(d) });
    expect(p.create).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(p.drop).toEqual(['2026-09-11', '2026-09-12']);
    // 2026-09-13 is not archived yet, so it stays — disk pressure over data loss.
    expect(p.blocked).toEqual([]);
  });

  it('holds back an expired day that R2 has not verified, and says so', () => {
    const p = planPartitions(['2026-09-01'], now, { keepDays: 14, aheadDays: 0, isArchived: () => false });
    expect(p.drop).toEqual([]);
    expect(p.blocked).toEqual(['2026-09-01']);
  });

  it('never drops a day inside the retention window, archived or not', () => {
    const p = planPartitions(['2026-09-20'], now, { keepDays: 14, aheadDays: 0, isArchived: () => true });
    expect(p.drop).toEqual([]);
  });
});

describe('the one-time migration', () => {
  const sql = partitionMigrationSql(HISTORY);

  it('blocks writers (not readers) for the copy, and fails fast if it cannot get the lock', () => {
    expect(sql).toMatch(/set local lock_timeout = '5s'/);
    expect(sql).toMatch(/lock table public\.video_score_history in share row exclusive mode/);
  });

  it('builds a range-partitioned twin with the partition key in the primary key', () => {
    expect(sql).toMatch(/partition by range \(scored_at\)/);
    expect(sql).toMatch(/primary key \(id, scored_at\)/);
    expect(sql).toMatch(/\(model_version, scored_at\)/);
    expect(sql).toMatch(/partition of public\.video_score_history_next default/);
  });

  it('copies every row, keeps the id sequence, swaps names, and repoints the dependent view', () => {
    expect(sql).toMatch(/insert into public\.video_score_history_next select \* from public\.video_score_history/);
    expect(sql).toMatch(/alter sequence public\.video_score_history_id_seq owned by public\.video_score_history_next\.id/);
    expect(sql).toMatch(/alter table public\.video_score_history rename to video_score_history_unpartitioned/);
    expect(sql).toMatch(/alter table public\.video_score_history_next rename to video_score_history/);
    expect(sql).toMatch(/create or replace view public\.video_scores_by_version/);
    expect(sql).toMatch(/grant all on public\.video_score_history to channelsmith_app/);
  });

  it('verifies the copy inside the transaction and aborts on any mismatch', () => {
    expect(sql).toMatch(/raise exception 'row count mismatch/);
  });

  it('is the exact file committed under sql/', () => {
    const file = fs.readFileSync(path.resolve(__dirname, '../../sql/2026-09-26-partition-video-score-history.sql'), 'utf8');
    expect(file).toContain(sql.trim());
  });

  it('lists partitions from the catalog', () => {
    expect(LIST_PARTITIONS_SQL).toMatch(/pg_inherits/);
  });
});
