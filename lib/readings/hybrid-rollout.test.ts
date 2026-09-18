import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('hybrid mode stops the scheduled corpus drain before credentials, database reads or R2 writes', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/rebuild-series.ts', '--drain'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 15_000,
    env: { NODE_ENV: 'test', PATH: process.env.PATH, HOME: process.env.HOME, SERIES_HYBRID: '1',
      SERIES_DISABLE: '0', NODE_PATH: path.join(process.cwd(), 'node_modules') },
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('hybrid charts: scheduled series publication disabled');
  expect(result.stdout).not.toContain('supabase.query');
});
