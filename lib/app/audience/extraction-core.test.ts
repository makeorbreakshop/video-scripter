import { batchesByVideo, parseModelJson, verifiedObservations } from './extraction-core';

test('batches remain within one video and 40 comments', () => {
  const comments = Array.from({ length: 85 }, (_, i) => ({ comment_id: String(i), video_id: i < 45 ? 'a' : 'b', text: 'A specific question' }));
  expect(batchesByVideo(comments).map((b) => [b.length, new Set(b.map((c) => c.video_id)).size])).toEqual([[40, 1], [5, 1], [40, 1]]);
});

test('rejects hallucinated or altered quotes and unknown comment IDs', () => {
  const comment = { comment_id: 'c', video_id: 'v', text: 'I own a Glowforge but need a larger bed.' };
  const raw = [
    { comment_id: 'c', type: 'tool_ownership', quote: 'I own a Glowforge', summary: 'Owns Glowforge', confidence: .9 },
    { comment_id: 'c', type: 'frustration', quote: 'I need a larger bed', summary: 'Needs space', confidence: .8 },
    { comment_id: 'x', type: 'question', quote: 'I own a Glowforge', summary: 'Wrong id', confidence: .8 },
  ];
  expect(verifiedObservations(raw, [comment])).toEqual([raw[0]]);
});

test('parses a fenced JSON payload while ignoring model prose after it', () => {
  expect(parseModelJson('```json\n[]\n```\nExplanation')).toEqual([]);
});
