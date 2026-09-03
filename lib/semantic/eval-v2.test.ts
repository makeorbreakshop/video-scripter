import {
  blindPoolId,
  bootstrapMeanCi,
  candidateIntroductions,
  freezeEvalManifest,
  validateEvalManifest,
  weightedKappa,
} from './eval-v2';

describe('semantic eval v2 protocol helpers', () => {
  test('freezes query/rubric manifests with deterministic hashes', () => {
    const manifest = freezeEvalManifest({
      version: 1,
      jobs: {
        J1: { queries: [{ id: 'j1-001', query: 'Make or Break Shop', target_id: 'UC123' }] },
        J4: { queries: [{ id: 'j4-001', query: 'laser engraver' }] },
      },
      rubrics: {
        J1: { scale: 'deterministic_exact_target' },
        J4: { scale: 'binary_on_topic_outlier' },
      },
    });

    expect(manifest.frozen_at).toBe('FROZEN');
    expect(manifest.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(freezeEvalManifest({
      version: 1,
      rubrics: manifest.rubrics,
      jobs: manifest.jobs,
    }).content_hash).toBe(manifest.content_hash);
    expect(() => validateEvalManifest(manifest)).not.toThrow();
  });

  test('rejects duplicate query ids and missing rubrics before pooling', () => {
    expect(() => validateEvalManifest({
      version: 1,
      frozen_at: 'FROZEN',
      content_hash: 'x',
      jobs: {
        J3: { queries: [{ id: 'dup', video_id: 'a' }, { id: 'dup', video_id: 'b' }] },
      },
      rubrics: {},
    })).toThrow(/duplicate query id|missing rubric/i);
  });

  test('creates stable blind pool ids that hide system identity', () => {
    const a = blindPoolId({ queryId: 'j4-001', entityType: 'video', entityId: 'abc', salt: 'eval-v2' });
    const b = blindPoolId({ queryId: 'j4-001', entityType: 'video', entityId: 'abc', salt: 'eval-v2' });
    const c = blindPoolId({ queryId: 'j4-001', entityType: 'video', entityId: 'abc', salt: 'other' });

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^pool_[a-f0-9]{20}$/);
  });

  test('only asks judges for candidates newly introduced by a system', () => {
    const existing = [
      { query_id: 'q1', entity_id: 'a' },
      { query_id: 'q1', entity_id: 'b' },
    ];
    const next = [
      { query_id: 'q1', system: 'bm25', entity_id: 'b', rank: 1 },
      { query_id: 'q1', system: 'bm25', entity_id: 'c', rank: 2 },
      { query_id: 'q2', system: 'bm25', entity_id: 'd', rank: 1 },
    ];

    expect(candidateIntroductions(existing, next).map((row) => row.entity_id)).toEqual(['c', 'd']);
  });

  test('computes calibration and confidence interval metrics', () => {
    expect(weightedKappa([0, 1, 2, 3], [0, 1, 2, 3], 3)).toBeCloseTo(1);
    expect(weightedKappa([0, 0, 3, 3], [3, 3, 0, 0], 3)).toBeLessThan(0);
    const ci = bootstrapMeanCi([1, 2, 3, 4], { iterations: 200, seed: 42 });
    expect(ci.mean).toBeCloseTo(2.5);
    expect(ci.low).toBeLessThanOrEqual(ci.mean);
    expect(ci.high).toBeGreaterThanOrEqual(ci.mean);
  });
});
