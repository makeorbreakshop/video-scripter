import fs from 'node:fs';
import path from 'node:path';

test('thumbnail target reads use transaction-local bounds without leaking session settings', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts/thumbnail-watch.ts'), 'utf8');
  expect(source).not.toMatch(/set\s+(?:session\s+)?statement_timeout\s*=\s*0/i);
  expect(source).toMatch(/set local statement_timeout/i);
  expect(source).toContain('boundedRead(HOT_TARGETS_SQL');
  expect(source).toContain('boundedRead(LONG_TAIL_TARGETS_SQL');
});
