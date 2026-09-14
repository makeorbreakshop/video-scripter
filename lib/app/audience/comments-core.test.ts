import { allowedPageSize, candidateVideos, hashAuthor, parseThread } from './comments-core';

test('candidate union and page caps cannot exceed first-pull budget', () => {
  const v = { id: 'a', comment_count: 100, published_at: null };
  expect(candidateVideos([v], [v, { ...v, id: 'b' }]).map((x) => x.id)).toEqual(['a', 'b']);
  expect(allowedPageSize(200, 2900, 0)).toBe(100);
  expect(allowedPageSize(299, 2999, 98)).toBe(1);
  expect(allowedPageSize(0, 0, 100)).toBe(0);
});

test('thread parser stores verbatim comment and keyed hash, never raw author', () => {
  const secret = Buffer.alloc(32, 4).toString('base64');
  const thread = { snippet: { topLevelComment: { id: 'c', snippet: {
    textOriginal: 'I need a lower-cost cutter.', authorChannelId: { value: 'UC-secret' },
    publishedAt: '2026-09-01T12:00:00Z', likeCount: 2,
  } } }, replies: { comments: [{ id: 'r', snippet: {
    textOriginal: 'Thank you so much!', authorChannelId: { value: 'UC-reply' },
    parentId: 'c', publishedAt: '2026-09-02T12:00:00Z',
  } }] } };
  const rows = parseThread(thread, 'channel', 'video', secret);
  expect(rows).toHaveLength(2);
  expect(rows[0].author_hash).toBe(hashAuthor('UC-secret', secret));
  expect(JSON.stringify(rows)).not.toContain('UC-secret');
  expect(rows[1].parent_id).toBe('c');
});
