import {
  buildJ5CandidateDocument,
  buildJ5TargetDocument,
  createJ5HashedEnvelope,
  j5Metrics,
  rankJ5Scores,
  selectJ5Variant,
  transferRankScore,
  validateJ5BlindCandidate,
  validateJ5Facet,
  validateJ5HashedEnvelope,
  validateOrDowngradeTransferDecision,
  validateTransferDecision,
} from './j5-rerank';

describe('J5 reranking helpers', () => {
  test('uses only the exact blind task identity as target context', () => {
    expect(buildJ5TargetDocument({
      id: 'j5-maker-transfer',
      lane: 'J5',
      intent: 'Find transferable framing.',
      seed: { channel_id: 'channel', channel_name: 'Make or Break Shop' },
    })).toBe('intent: Find transferable framing.\ntarget channel: Make or Break Shop');
  });

  test('rebuilds the frozen candidate document recipe exactly', () => {
    expect(buildJ5CandidateDocument({
      title: 'A title', channel_name: 'A channel', description: 'A description',
    })).toBe('title: A title\nchannel: A channel\ndescription: A description');
  });

  test('rejects challenger candidates whose judge input hashes do not bind the exact blind payload', () => {
    const candidate = {
      blind_id: 'blind_one', task_id: 'j5-maker-transfer', entity_id: 'video',
      title: 'A title', channel_name: 'A channel', description: 'A description',
    };
    const expected = 'd425e1db66e8ce1526aa26d8174bd613feb89f53fc6efb7a1422d3220d370436';
    expect(validateJ5BlindCandidate(candidate, [expected, expected])).toEqual({
      blind_id: 'blind_one',
      entity_id: 'video',
      candidate_text: 'title: A title\nchannel: A channel\ndescription: A description',
      judge_input_hash: expected,
    });
    expect(() => validateJ5BlindCandidate(candidate, [expected, 'bad'])).toThrow(/judge input hash/i);
  });

  test('ranks finite scores descending with an entity-id tie break', () => {
    expect(rankJ5Scores([
      { entity_id: 'b', score: 0.5 },
      { entity_id: 'c', score: 0.8 },
      { entity_id: 'a', score: 0.5 },
    ]).map((row) => row.entity_id)).toEqual(['c', 'a', 'b']);
    expect(() => rankJ5Scores([{ entity_id: 'a', score: Number.NaN }])).toThrow(/finite/i);
    expect(() => rankJ5Scores([{ entity_id: 'a', score: 1 }, { entity_id: 'a', score: 2 }])).toThrow(/duplicate/i);
  });

  test('reports creative lower/upper sensitivity and copying separately', () => {
    const metrics = j5Metrics(
      ['creative', 'unresolved', 'direct', 'background'],
      { creative: 'creative_adaptation', unresolved: 'unresolved', direct: 'direct_application', background: 'background' },
      4,
    );
    expect(metrics.lower_precision_at_k).toBe(0.25);
    expect(metrics.upper_precision_at_k).toBe(0.5);
    expect(metrics.direct_application_rate_at_k).toBe(0.25);
    expect(metrics.unresolved_at_k).toBe(1);
    expect(() => j5Metrics(['creative', 'missing'], { creative: 'creative_adaptation' }, 2))
      .toThrow(/label coverage/i);
    expect(() => j5Metrics(['creative'], { creative: 'creative_adaptation', extra: 'none' }, 1))
      .toThrow(/label coverage/i);
  });

  test('rejects modified resume checkpoints', () => {
    const envelope = createJ5HashedEnvelope({ input_content_hash: 'input', decisions: ['one'] });
    expect(validateJ5HashedEnvelope(envelope)).toEqual(envelope.body);
    expect(() => validateJ5HashedEnvelope({ ...envelope, body: { ...envelope.body, decisions: ['two'] } }))
      .toThrow(/content hash/i);
  });

  test('enforces the explicit creative-transfer decision contract', () => {
    const creative = {
      task_id: 'task', candidate_id: 'video', domain_relation: 'unrelated' as const,
      preserved_purpose: 'help choose confidently', preserved_mechanism: 'controlled comparison',
      changed_surface: 'replace kitchen tools with laser cutters', adapted_concept: 'test three lasers on one product job',
      purpose_fit: 3 as const, mechanism_fit: 2 as const, audience_fit: 3 as const, mapping_specificity: 2 as const,
      verdict: 'creative_adaptation' as const, confidence: 'high' as const, blocking_reasons: [],
    };
    expect(validateTransferDecision(creative)).toEqual(creative);
    expect(transferRankScore(creative)).toBeGreaterThan(300);
    expect(() => validateTransferDecision({ ...creative, domain_relation: 'adjacent' })).toThrow(/creative_adaptation/i);
    expect(validateOrDowngradeTransferDecision({ ...creative, domain_relation: 'adjacent' })).toMatchObject({
      domain_relation: 'adjacent',
      verdict: 'direct_application',
      confidence: 'low',
      blocking_reasons: ['invalid creative mapping downgraded'],
    });
    const invalidFallback = validateOrDowngradeTransferDecision({ ...creative, purpose_fit: 1 });
    expect(invalidFallback).toMatchObject({
      verdict: 'none',
      confidence: 'low',
      blocking_reasons: ['invalid creative mapping downgraded'],
    });
    expect(transferRankScore(invalidFallback)).toBeLessThan(0);
    expect(transferRankScore(validateTransferDecision({
      ...creative, domain_relation: 'same', verdict: 'direct_application', adapted_concept: null,
    }))).toBeLessThan(100);
  });

  test('accepts only packaging-evidence facets with both abstractions', () => {
    const facet = {
      entity_id: 'video', entity_kind: 'candidate_video' as const, niche: 'kitchen tools',
      purpose_observed: 'help choose a tool', purpose_abstract: 'reduce purchase uncertainty',
      mechanism_observed: 'side-by-side test', mechanism_abstract: 'controlled comparison',
      evidence_status: 'packaging_only' as const, confidence: 'medium' as const,
    };
    expect(validateJ5Facet(facet)).toEqual(facet);
    expect(() => validateJ5Facet({ ...facet, purpose_abstract: '' })).toThrow(/purpose_abstract/i);
    expect(() => validateJ5Facet({ ...facet, evidence_status: 'verified' as never })).toThrow(/packaging_only/i);
  });

  test('selects only a gated dev winner and rejects unresolved top ten', () => {
    const passing = {
      lower_precision_at_k: 0.4, upper_precision_at_k: 0.4, lower_ndcg_at_20: 0.5, upper_ndcg_at_20: 0.5,
      direct_application_rate_at_k: 0.1, unresolved_at_k: 0, creative_hits_at_k: 4,
    };
    expect(selectJ5Variant([
      { name: 'cross_encoder', task_metrics: [{ ...passing, creative_hits_at_k: 3 }, passing] },
      { name: 'purpose_mechanism', task_metrics: [passing, { ...passing, lower_ndcg_at_20: 0.7, upper_ndcg_at_20: 0.7 }] },
    ])).toBe('purpose_mechanism');
    expect(selectJ5Variant([{ name: 'blocked', task_metrics: [{ ...passing, unresolved_at_k: 1 }, passing] }])).toBeNull();
    expect(selectJ5Variant([{ name: 'invalid', task_metrics: [{ ...passing, lower_precision_at_k: Number.NaN }, passing] }]))
      .toBeNull();
  });
});
