import fs from 'node:fs';
import path from 'node:path';
const source = fs.readFileSync(path.join(__dirname, '../../scripts/rss-poll.ts'), 'utf8');
test('scheduled poller preserves HTTP evidence through its pending buffer and filtered sample writer', () => {
  expect(source).toContain('responses: FeedResponse[]');
  expect(source).toContain("res.headers.get('date')");
  expect(source).toContain("res.headers.get('age')");
  expect(source).toContain("res.headers.get('cache-control')");
  expect(source).toContain('saveRssObservations(pool, b.samples, b.responses)');
  expect(source).not.toContain('insert into rss_samples');
  expect(source).toContain('buf.responses.push(');
});
