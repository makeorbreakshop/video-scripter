import {
  PACKAGING_TRANSFER_CONFIG,
  cosineSimilarity,
  extractChannelTitles,
  extractTitleForm,
  normalizeTitleSkeleton,
  packagingTransferGate,
  rankPackagingTransfer,
  type PackagingTransferCandidate,
} from './packaging-transfer';

function candidate(overrides: Partial<PackagingTransferCandidate> = {}): PackagingTransferCandidate {
  return {
    entity_id: 'candidate',
    channel_id: 'channel',
    title: 'I Tested 10 Coffee Makers — Here Is My Verdict',
    document_affinity: 0.5,
    source_document_affinity: null,
    outlier_score: 4,
    n_baseline: 10,
    ...overrides,
  };
}

describe('programmatic packaging transfer', () => {
  test('normalizes title form while masking content-bearing subjects and amounts', () => {
    const skeleton = normalizeTitleSkeleton('I Tested a $549 Sander and a $55 Sander… I Get It Now (2026)');
    expect(skeleton).toBe('i tested subject [price] subject and subject [price] subject i get it now [year]');
    expect(skeleton).not.toContain('sander');
  });

  test('extracts observable packaging signals without inferring topic', () => {
    expect(extractTitleForm('Why I Tested 7 Cheap vs Expensive Tools for 30 Days — My Honest Verdict?').signals)
      .toEqual(expect.arrayContaining([
        'comparison', 'first_person', 'question', 'test', 'time_constraint', 'verdict', 'why',
      ]));
    expect(extractTitleForm('I’m Testing What You Don’t Need').signals)
      .toEqual(expect.arrayContaining(['first_person', 'test', 'warning']));
  });

  test('extracts only representative titles from the frozen seed-channel document', () => {
    const titles = Array.from({ length: 20 }, (_, index) => `Title ${index + 1}`);
    expect(extractChannelTitles(['Make or Break Shop', ...titles].join('\n'), 'Make or Break Shop'))
      .toEqual(titles);
    expect(() => extractChannelTitles('Another channel\nFirst title', 'Make or Break Shop'))
      .toThrow(/channel identity/i);
    expect(() => extractChannelTitles('Make or Break Shop\nOnly one title', 'Make or Break Shop'))
      .toThrow(/exactly 20/i);
    expect(() => extractChannelTitles(['Make or Break Shop', ...titles, 'trailing niche'].join('\n'), 'Make or Break Shop'))
      .toThrow(/exactly 20/i);
  });

  test('computes exact cosine similarity and rejects invalid vectors', () => {
    expect(cosineSimilarity([1, 0], [0.5, 0.5])).toBeCloseTo(Math.SQRT1_2);
    expect(() => cosineSimilarity([1], [1, 0])).toThrow(/dimensions/i);
    expect(() => cosineSimilarity([Number.NaN], [1])).toThrow(/finite/i);
    expect(() => cosineSimilarity([0, 0], [1, 0])).toThrow(/non-zero/i);
  });

  test('cross-topic scoring prefers the same packaging form in a different topic', () => {
    const targetTitles = ['I Tested 30 Lasers — Here Is My Verdict'];
    const rows = [
      candidate({ entity_id: 'b-direct', channel_id: 'same-topic', document_affinity: 0.92 }),
      candidate({ entity_id: 'a-transfer', channel_id: 'other-topic', document_affinity: 0.42 }),
    ];
    expect(rankPackagingTransfer(rows, targetTitles, 'title_form').map((row) => row.entity_id))
      .toEqual(['a-transfer', 'b-direct']);
    expect(rankPackagingTransfer(rows, targetTitles, 'title_form').map((row) => row.score))
      .toEqual([rankPackagingTransfer(rows, targetTitles, 'title_form')[0].score,
        rankPackagingTransfer(rows, targetTitles, 'title_form')[0].score]);
    expect(rankPackagingTransfer(rows, targetTitles, 'cross_topic').map((row) => row.entity_id))
      .toEqual(['a-transfer', 'b-direct']);
    const ranked = rankPackagingTransfer(rows, targetTitles, 'cross_topic');
    expect(ranked[0].components.document_novelty).toBeGreaterThan(ranked[1].components.document_novelty);
  });

  test('uses the closer of video and source-channel documents for novelty', () => {
    const targetTitles = ['I Tested 30 Lasers — Here Is My Verdict'];
    const ranked = rankPackagingTransfer([
      candidate({ entity_id: 'hidden-direct', document_affinity: 0.2, source_document_affinity: 0.95 }),
      candidate({ entity_id: 'transfer', document_affinity: 0.4, source_document_affinity: 0.45 }),
    ], targetTitles, 'cross_topic');
    expect(ranked.map((row) => row.entity_id)).toEqual(['transfer', 'hidden-direct']);
    expect(ranked[0].components.document_novelty).toBeGreaterThan(ranked[1].components.document_novelty);
  });

  test('freezes the primary recipe before evaluation and normalizes proof against the corpus', () => {
    expect(PACKAGING_TRANSFER_CONFIG.weights.cross_topic).toEqual({
      title_form: 0.25, document_novelty: 0.6, outlier_strength: 0.15,
    });
    const targetTitles = ['I Tested 30 Lasers'];
    const ranked = rankPackagingTransfer([
      candidate({ entity_id: 'strong', outlier_score: 8, n_baseline: 40 }),
      candidate({ entity_id: 'weak', outlier_score: 3, n_baseline: 5 }),
    ], targetTitles, 'title_form', {
      proof_population: [
        { outlier_score: 2, n_baseline: 5 },
        { outlier_score: 4, n_baseline: 10 },
        { outlier_score: 8, n_baseline: 40 },
      ],
    });
    expect(ranked.find((row) => row.entity_id === 'strong')!.components.outlier_strength)
      .toBeGreaterThan(ranked.find((row) => row.entity_id === 'weak')!.components.outlier_strength);
  });

  test('rejects duplicate candidates and non-finite ranking inputs', () => {
    const targetTitles = ['I Tested 30 Lasers'];
    expect(() => rankPackagingTransfer([
      candidate({ entity_id: 'same' }), candidate({ entity_id: 'same' }),
    ], targetTitles, 'cross_topic')).toThrow(/duplicate/i);
    expect(() => rankPackagingTransfer([
      candidate({ document_affinity: Number.NaN }),
    ], targetTitles, 'cross_topic')).toThrow(/finite/i);
  });

  test('diversified ranking caps channel domination in the top results', () => {
    const targetTitles = ['I Tested 30 Lasers — Here Is My Verdict'];
    const rows = [
      candidate({ entity_id: 'a1', channel_id: 'dominant' }),
      candidate({ entity_id: 'a2', channel_id: 'dominant' }),
      candidate({ entity_id: 'a3', channel_id: 'dominant' }),
      candidate({ entity_id: 'b1', channel_id: 'different' }),
    ];
    const top = rankPackagingTransfer(rows, targetTitles, 'cross_topic_diverse').slice(0, 3);
    expect(top.filter((row) => row.channel_id === 'dominant')).toHaveLength(2);
    expect(top.map((row) => row.entity_id)).toContain('b1');
  });

  test('ranking is deterministic regardless of candidate input order', () => {
    const targetTitles = ['The Best Laser to Get in 2026?'];
    const rows = [
      candidate({ entity_id: 'z', channel_id: 'z-channel' }),
      candidate({ entity_id: 'a', channel_id: 'a-channel' }),
    ];
    expect(rankPackagingTransfer(rows, targetTitles, 'cross_topic').map((row) => row.entity_id))
      .toEqual(rankPackagingTransfer([...rows].reverse(), targetTitles, 'cross_topic').map((row) => row.entity_id));
  });

  test('applies the primary gate independently to every task', () => {
    const passing = {
      lower_precision_at_k: 0.3,
      direct_application_rate_at_k: 0.2,
      creative_hits_at_k: 3,
      unresolved_at_k: 0,
      unique_channels_at_10: 8,
    };
    expect(packagingTransferGate([passing, passing])).toEqual({ passed: true, failures: [] });
    expect(packagingTransferGate([passing, { ...passing, unresolved_at_k: 1 }])).toEqual({
      passed: false,
      failures: ['task 2: unresolved_at_k 1 > 0'],
    });
    expect(() => packagingTransferGate([
      { ...passing, task_id: 'maker' }, { ...passing, task_id: 'maker' },
    ], { expected_task_ids: ['maker', 'tech'] })).toThrow(/task coverage/i);
    expect(() => packagingTransferGate([{ ...passing, lower_precision_at_k: Number.NaN }]))
      .toThrow(/finite/i);
  });
});
