import fs from 'node:fs';
import path from 'node:path';

test('the default Jest run cannot discover database or external-service integration tests', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const config = require(path.join(process.cwd(), 'jest.config.cjs'));
  expect(config.testPathIgnorePatterns).toEqual(expect.arrayContaining([
    '\\.integration\\.test\\.ts$',
    '\\.db\\.test\\.ts$',
    '<rootDir>/lib/ingest/is-short-trigger.test.ts',
    '<rootDir>/lib/ingest/no-db-shorts-rule.test.ts',
  ]));
});

test.each([
  'lib/scoring/obs-cache.integration.test.ts',
  'lib/readings/series-equality.integration.test.ts',
  'lib/ingest/is-short-trigger.test.ts',
  'lib/ingest/no-db-shorts-rule.test.ts',
])('%s requires an explicit opt-in even when targeted', (relativePath) => {
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
  expect(source).toContain("process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1'");
});
