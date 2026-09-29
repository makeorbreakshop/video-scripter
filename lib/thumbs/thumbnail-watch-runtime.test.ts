import fs from 'node:fs';
import path from 'node:path';

test('thumbnail target reads use transaction-local bounds without leaking session settings', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts/thumbnail-watch.ts'), 'utf8');
  expect(source).not.toMatch(/set\s+(?:session\s+)?statement_timeout\s*=\s*0/i);
  expect(source).toMatch(/set local statement_timeout/i);
  expect(source).toContain('boundedRead(HOT_TARGETS_SQL');
  expect(source).toContain('boundedRead(LONG_TAIL_TARGETS_SQL');
});

test('a 304 costs no per-video read and its last_checked stamps are written once per group', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts/thumbnail-watch.ts'), 'utf8');
  const loop = source.slice(source.indexOf('for (const group of chunk(targets'), source.indexOf('console.log(\n  `Done.'));
  // The stored ETag comes with the target; the full latest row is read only after a 200.
  expect(loop).toMatch(/If-None-Match': target\.etag/);
  expect(loop.indexOf('select version, sha256, phash, etag from thumbnail_versions'))
    .toBeGreaterThan(loop.indexOf('if (!res.ok) return;'));
  expect(loop).toContain('THUMB_CHECKED_BATCH_SQL');
  expect(loop).not.toMatch(/update thumbnail_versions set last_checked=now\(\) where video_id=\$1 and version=\$2`/);
});
