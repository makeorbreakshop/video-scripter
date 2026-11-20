import fs from 'node:fs';
import path from 'node:path';
const source = fs.readFileSync(path.join(__dirname, '../../scripts/rss-poll.ts'), 'utf8');
// The Buffers type moved to lib/rss/pending-replay.ts (2026-09-22 chunked replay).
const buffers = fs.readFileSync(path.join(__dirname, 'pending-replay.ts'), 'utf8');
test('scheduled poller preserves HTTP evidence through its pending buffer and filtered sample writer', () => {
  expect(buffers).toContain('responses: FeedResponse[]');
  expect(source).toContain("from '../lib/rss/pending-replay'");
  expect(source).toContain("res.headers.get('date')");
  expect(source).toContain("res.headers.get('age')");
  expect(source).toContain("res.headers.get('cache-control')");
  expect(source).toContain('saveRssObservations(pool, b.samples, b.responses, RESPONSE_STATE_CACHE)');
  expect(source).not.toContain('insert into rss_samples');
  expect(source).toContain('buf.responses.push(');
});
