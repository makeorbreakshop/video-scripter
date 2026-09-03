import {
  blindCandidateInputHash,
  resolveV4Judgments,
  validateJudgmentAssignment,
} from './judgments-v4';

const candidate = {
  blind_id: 'blind_one',
  task_id: 'task',
  entity_id: 'entity',
  title: 'A title',
  channel_name: 'A channel',
  description: 'A description',
};

describe('semantic v4 judgment validation', () => {
  test('requires exact coverage, input hashes, and lane-shaped outputs', () => {
    const valid = [{
      blind_id: candidate.blind_id,
      input_hash: blindCandidateInputHash(candidate),
      output: { topic: 2, packaging: 1 },
      confidence: 'high' as const,
      rationale: 'Topic overlaps; packaging is weaker.',
      judged_at: '2026-09-03T12:00:00.000Z',
    }];
    expect(() => validateJudgmentAssignment('J3', [candidate], valid)).not.toThrow();
    expect(() => validateJudgmentAssignment('J3', [candidate], [{ ...valid[0], input_hash: 'bad' }]))
      .toThrow(/input hash/i);
    expect(() => validateJudgmentAssignment('J4', [candidate], [{ ...valid[0], output: 2 }]))
      .toThrow(/J4/i);
    expect(() => validateJudgmentAssignment('J3', [candidate, { ...candidate, blind_id: 'blind_two' }], valid))
      .toThrow(/coverage/i);
  });
});

describe('semantic v4 judgment resolution', () => {
  test('accepts a two-pass agreement without adjudication', () => {
    expect(resolveV4Judgments('J2', 2, 2)).toEqual({
      resolved: 2,
      needs_adjudication: false,
    });
  });

  test('uses the median for ordinal dimensions after a disagreement', () => {
    expect(resolveV4Judgments('J3',
      { topic: 3, packaging: 0 },
      { topic: 1, packaging: 2 },
      { topic: 2, packaging: 1 },
    )).toEqual({
      resolved: { topic: 2, packaging: 1 },
      needs_adjudication: false,
    });
  });

  test('uses majority vote for J4 and agreement-or-unresolved for J5', () => {
    expect(resolveV4Judgments('J4', 1, 0, 1).resolved).toBe(1);
    expect(resolveV4Judgments('J5', 'creative_adaptation', 'none').needs_adjudication).toBe(true);
    expect(resolveV4Judgments('J5', 'creative_adaptation', 'none', 'creative_adaptation').resolved)
      .toBe('creative_adaptation');
    expect(resolveV4Judgments('J5', 'creative_adaptation', 'none', 'background').resolved)
      .toBe('unresolved');
  });
});
