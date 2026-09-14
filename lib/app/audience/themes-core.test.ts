import { verifiedThemes } from './themes-core';

test('drops singletons, invented IDs and overlapping assignments', () => {
  const observations = [1, 2, 3, 4].map((id) => ({ id, type: 'question' as const, summary: String(id) }));
  expect(verifiedThemes([
    { label: 'A', description: 'a', observation_ids: [1, 2, 900] },
    { label: 'B', description: 'b', observation_ids: [2, 3] },
    { label: 'C', description: 'c', observation_ids: [3, 4] },
  ], observations)).toEqual([
    { label: 'A', description: 'a', observation_ids: [1, 2] },
    { label: 'C', description: 'c', observation_ids: [3, 4] },
  ]);
});
