import { verifiedConsolidation, verifiedThemes } from './themes-core';

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

test('consolidation merges only valid candidate groups and preserves observation IDs', () => {
  const candidates = [
    { candidate_id: 1, label: 'Buying', description: 'a', observation_ids: [1, 2] },
    { candidate_id: 2, label: 'Buying advice', description: 'b', observation_ids: [3, 4] },
    { candidate_id: 3, label: 'Settings', description: 'c', observation_ids: [5, 6] },
  ];
  expect(verifiedConsolidation([
    { label: 'Buying decisions', description: 'd', candidate_ids: [1, 2, 99] },
    { label: 'Duplicate', description: 'e', candidate_ids: [2] },
    { label: 'Settings', description: 'f', candidate_ids: [3] },
  ], candidates)).toEqual([
    { label: 'Buying decisions', description: 'd', observation_ids: [1, 2, 3, 4] },
    { label: 'Settings', description: 'f', observation_ids: [5, 6] },
  ]);
});
