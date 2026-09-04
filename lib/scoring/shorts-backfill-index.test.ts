// Guard: the verify-shorts target query must stay index-served.
//
// On 2026-09-04 two backfill LaunchAgents ran a target query whose WHERE was
//   (duration ~ '^PT[0-9HMS]+$' and extract(epoch from duration::interval) <= 180) or is_short
// No index could cover that OR, so every run re-read 100K-200K heap tuples out of a 1.7 GB
// table. The instance sat in IO wait for 10+ minutes at a time, the hourly scorer hit its
// 300s statement_timeout (57014) for six hours straight and its backlog grew 1.5K -> 7.3K.
//
// The fix is a pair of partial indexes (sql/2026-09-04-shorts-backfill-index.sql) whose
// predicates are written character for character like the query. That coupling is invisible at
// runtime — the query just gets slow — so it is asserted here instead.
import fs from 'fs';
import path from 'path';
import { SHORT_MAX_SECONDS } from './longform';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const script = read('scripts/verify-shorts.ts');
const migration = read('sql/2026-09-04-shorts-backfill-index.sql');

// The two arms of the target list, exactly as the script builds them.
const FLAGGED_PREDICATE = 'v.is_short';
const DEFAULT_PREDICATE = `(v.is_short or iso8601_duration_seconds(v.duration) <= ${SHORT_MAX_SECONDS})`;
const unalias = (s: string) => s.replace(/\bv\./g, '');

describe('verify-shorts target query is index-served', () => {
  test('the script asks for exactly the two indexed predicates', () => {
    expect(script).toContain(`'${FLAGGED_PREDICATE}'`);
    expect(script).toContain(DEFAULT_PREDICATE.replace(String(SHORT_MAX_SECONDS), '${SHORT_MAX_SECONDS}'));
  });

  test('the migration indexes both predicates on (published_at desc)', () => {
    const sql = migration.replace(/\s+/g, ' ');
    expect(sql).toContain(
      'create index concurrently if not exists videos_shorts_flagged_unchecked_idx on videos (published_at desc) ' +
      `where shorts_checked_at is null and ${unalias(FLAGGED_PREDICATE)}`
    );
    expect(sql).toContain(
      'create index concurrently if not exists videos_shorts_backfill_idx on videos (published_at desc) ' +
      `where shorts_checked_at is null and ${unalias(DEFAULT_PREDICATE)}`
    );
  });

  test('the un-indexable inline duration regex + interval cast is gone from the script', () => {
    expect(script).not.toMatch(/duration ~ '\^PT/);
    expect(script).not.toMatch(/extract\(epoch from v\.duration::interval\)/);
  });

  test('the backfill stays polite: concurrency capped at 3 and a per-connection statement_timeout', () => {
    expect(script).toMatch(/Math\.min\(Number\(arg\('--concurrency'\)[^)]*\)[^,]*,\s*3\)/);
    expect(script).toMatch(/set statement_timeout = 300000/);
    expect(script).toMatch(/Math\.min\(Number\(arg\('--limit'\)[^)]*\)[^,]*,\s*20000\)/);
  });
});
