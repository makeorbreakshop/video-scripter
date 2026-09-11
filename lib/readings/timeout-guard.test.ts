// Guards the fix for the broken statement_timeout pattern (2026-09-08 investigation §5).
//
// `pool.on('connect', c => c.query('set statement_timeout = …'))` is queued asynchronously on
// the :6543 transaction pooler and lands AFTER the queries it was meant to protect, so every
// script using it silently ran at the 300 s role default. The existing evaluator-safety test
// only guarded one file; this guards the files that were converted, so the pattern cannot creep
// back into them.
import fs from 'node:fs';
import path from 'node:path';

const CONVERTED = [
  'lib/admin/db.ts',
  'lib/unified-video-import.ts',
  'scripts/score-videos.ts',
  'scripts/verify-shorts.ts',
  'scripts/validate-scoring.ts',
  'scripts/backtest-baseline.ts',
  'scripts/fit-forecast-bands.ts',
  'scripts/archive-readings.ts',
  'scripts/thin-readings.ts',
  'scripts/verify-archive.ts',
  // The benchmark/backtest harness. Converted 2026-09-08: on the v5.3 attempt these ran at the
  // role default, the client gave up first, and the query kept running server-side.
  'scripts/backtest-baseline-trend.ts',
  'scripts/check-band-calibration.ts',
  'scripts/benchmark-scores.ts',
];

/**
 * Code only. Several of these files explain the broken pattern in a comment so the next reader
 * knows why it is gone; a guard that matched prose would forbid documenting the bug.
 */
const read = (f: string) =>
  fs.readFileSync(path.join(process.cwd(), f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('statement_timeout is set in a form that actually applies', () => {
  test.each(CONVERTED)('%s does not use the async pool.on(connect) SET', (file) => {
    expect(read(file)).not.toMatch(/pool\.on\(\s*['"]connect['"]/);
  });

  test.each(CONVERTED)('%s never sets a session-level statement_timeout', (file) => {
    // `set local` is fine; a bare or SESSION-scoped SET is the broken form.
    expect(read(file)).not.toMatch(/set\s+(?:session\s+)?statement_timeout/i);
  });

  test('withTimeout wraps the statement in an explicit transaction with set local', () => {
    const src = read('lib/admin/db.ts');
    expect(src).toMatch(/begin; set local statement_timeout/);
    expect(src).toMatch(/commit/);
    expect(src).toMatch(/rollback/);
  });

  test('makeTimedPool routes every pool.query through withTimeout', () => {
    const src = read('lib/admin/db.ts');
    expect(src).toMatch(/export function makeTimedPool/);
    expect(src).toMatch(/poolWithTimeout\(p, timeoutMs/);
  });

  test('makeTimedPool reapplies application_name inside the pooler transaction', () => {
    const src = read('lib/admin/db.ts');
    expect(src).toContain("set_config('application_name'");
    expect(src).toMatch(/poolWithTimeout\(p, timeoutMs,[\s\S]*applicationName/);
  });

  test('the archive scripts take their timeout from makeTimedPool, not from a bare SET', () => {
    for (const f of ['scripts/archive-readings.ts', 'scripts/thin-readings.ts', 'scripts/verify-archive.ts']) {
      expect(read(f)).toMatch(/makeTimedPool\(\{[^}]*timeoutMs:/);
    }
  });

  // A benchmark that abandons a query without stopping it is how the database got saturated on
  // 2026-09-08: the harness moved on, the backend kept reading, and the next run piled on top.
  test('the benchmark harness cannot orphan a query', () => {
    for (const f of ['scripts/backtest-baseline-trend.ts', 'scripts/check-band-calibration.ts', 'scripts/benchmark-scores.ts']) {
      expect(read(f)).toMatch(/makeTimedPool\(\{[^}]*timeoutMs:/);
    }
  });
});

describe('the delete path cannot run without the verification gate', () => {
  test('thin-readings consults the ledger before every delete', () => {
    const src = read('scripts/thin-readings.ts');
    expect(src).toMatch(/isThinnable\(/);
    expect(src).toMatch(/LEDGER_SELECT_SQL/);
  });

  test('archive-readings never issues a delete or a truncate', () => {
    const src = read('scripts/archive-readings.ts');
    expect(src).not.toMatch(/\bdelete\s+from\b/i);
    expect(src).not.toMatch(/\btruncate\b/i);
  });

  test('the thumbnails bucket and its Worker are not touched', () => {
    for (const f of ['lib/readings/archive.ts', 'scripts/archive-readings.ts', 'scripts/thin-readings.ts']) {
      expect(read(f)).not.toMatch(/channelsmith-thumb/i);
      expect(read(f)).not.toMatch(/THUMBS_(?:BASE_URL|UPLOAD_SECRET)/);
    }
  });
});
