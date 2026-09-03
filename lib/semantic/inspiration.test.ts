import { QdrantUnavailableError } from './qdrant';
import {
  INSPIRATION_RECIPE,
  inspirationSearchState,
  parseInspirationDistance,
  rankInspirationCandidates,
  type InspirationCandidate,
} from './inspiration';

function candidate(overrides: Partial<InspirationCandidate> = {}): InspirationCandidate {
  return {
    entity_id: 'video-1',
    channel_id: 'channel-1',
    title: 'I Tested 10 Coffee Makers — Here Is My Verdict',
    document_affinity: 0.5,
    source_document_affinity: 0.5,
    outlier_score: 4,
    n_baseline: 12,
    ...overrides,
  };
}

describe('private inspiration ranking', () => {
  const targetTitles = ['I Tested 30 Lasers — Just Buy This One'];
  const rows = [
    candidate({ entity_id: 'near', channel_id: 'near-channel', document_affinity: 0.9, source_document_affinity: 0.88 }),
    candidate({ entity_id: 'middle', channel_id: 'middle-channel', document_affinity: 0.6, source_document_affinity: 0.58 }),
    candidate({ entity_id: 'far', channel_id: 'far-channel', document_affinity: 0.2, source_document_affinity: 0.22 }),
  ];

  test('uses one deterministic recipe with distance-specific fit', () => {
    expect(INSPIRATION_RECIPE).toBe('inspiration-sandbox-v1');
    expect(rankInspirationCandidates(rows, targetTitles, 'near')[0].entity_id).toBe('near');
    expect(rankInspirationCandidates(rows, targetTitles, 'balanced')[0].entity_id).toBe('middle');
    expect(rankInspirationCandidates(rows, targetTitles, 'far')[0].entity_id).toBe('far');

    const ranked = rankInspirationCandidates(rows, targetTitles, 'balanced');
    expect(ranked[0].components).toEqual(expect.objectContaining({
      packaging_form: expect.any(Number),
      content_proximity: 0.5,
      distance_fit: 1,
      outlier_strength: expect.any(Number),
    }));
  });

  test('uses source-channel affinity when it reveals a candidate is actually nearby', () => {
    const ranked = rankInspirationCandidates([
      candidate({ entity_id: 'apparently-far', channel_id: 'a', document_affinity: 0.1, source_document_affinity: 0.95 }),
      candidate({ entity_id: 'actually-far', channel_id: 'b', document_affinity: 0.3, source_document_affinity: 0.32 }),
    ], targetTitles, 'far');
    expect(ranked[0].entity_id).toBe('actually-far');
    expect(ranked[0].components.content_proximity).toBeLessThan(ranked[1].components.content_proximity);
  });

  test('keeps the first page diverse without discarding ranked overflow', () => {
    const crowded = [
      candidate({ entity_id: 'a1', channel_id: 'a', document_affinity: 0.91 }),
      candidate({ entity_id: 'a2', channel_id: 'a', document_affinity: 0.90 }),
      candidate({ entity_id: 'a3', channel_id: 'a', document_affinity: 0.89 }),
      candidate({ entity_id: 'b1', channel_id: 'b', document_affinity: 0.88 }),
    ];
    const ranked = rankInspirationCandidates(crowded, targetTitles, 'near');
    expect(ranked.slice(0, 3).map((row) => row.entity_id)).toEqual(['a1', 'a2', 'b1']);
    expect(ranked.map((row) => row.entity_id)).toEqual(expect.arrayContaining(['a3']));
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
  });

  test('is deterministic and rejects malformed candidates', () => {
    expect(rankInspirationCandidates(rows, targetTitles, 'near').map((row) => row.entity_id))
      .toEqual(rankInspirationCandidates([...rows].reverse(), targetTitles, 'near').map((row) => row.entity_id));
    expect(() => rankInspirationCandidates([
      candidate({ entity_id: 'duplicate' }), candidate({ entity_id: 'duplicate' }),
    ], targetTitles, 'near')).toThrow(/duplicate/i);
    expect(() => rankInspirationCandidates([
      candidate({ document_affinity: Number.NaN }),
    ], targetTitles, 'near')).toThrow(/finite/i);
  });

  test('parses distance defensively', () => {
    expect(parseInspirationDistance('near')).toBe('near');
    expect(parseInspirationDistance(['far'])).toBe('far');
    expect(parseInspirationDistance('anything-else')).toBe('balanced');
  });
});

describe('inspiration availability', () => {
  test('degrades cleanly only when the local vector service is unavailable', async () => {
    await expect(inspirationSearchState(async () => ['result']))
      .resolves.toEqual({ status: 'ready', value: ['result'] });
    await expect(inspirationSearchState(async () => {
      throw new QdrantUnavailableError('offline');
    })).resolves.toEqual({ status: 'unavailable' });
    await expect(inspirationSearchState(async () => {
      throw new Error('ranking bug');
    })).rejects.toThrow('ranking bug');
  });
});
