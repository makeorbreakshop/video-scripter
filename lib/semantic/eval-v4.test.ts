import {
  BlindCandidate,
  CorpusEligibilityRow,
  V4Task,
  buildBlindPool,
  freezeV4CorpusManifest,
  freezeV4TaskManifest,
  isEligibleCorpusRow,
  ndcgAtK,
  pooledRecallAtK,
  precisionAtK,
  validateV4TaskManifest,
} from './eval-v4';

const asOf = '2026-09-03T16:00:00.000Z';

function eligibleRow(overrides: Partial<CorpusEligibilityRow> = {}): CorpusEligibilityRow {
  return {
    id: 'video-1',
    channel_id: 'channel-1',
    title: 'A useful video',
    published_at: '2026-06-01T12:00:00.000Z',
    is_short: false,
    duration: 'PT12M',
    is_institutional: false,
    score: 3.2,
    confidence: 'confirmed',
    n_baseline: 8,
    baseline: 25_000,
    scored_at: '2026-09-03T09:00:00-04:00',
    ...overrides,
  };
}

function tasks(): V4Task[] {
  return [
    { id: 'j1-dev', lane: 'J1', split: 'dev', query: 'Make or Break Shop', target_id: 'c1' },
    { id: 'j1-heldout', lane: 'J1', split: 'heldout', query: '@mkbhd', target_id: 'c2' },
    { id: 'j2-dev-1', lane: 'J2', split: 'dev', seed: { channel_id: 'c1', channel_name: 'Make or Break Shop', subscriber_count: 250_000 } },
    { id: 'j2-dev-2', lane: 'J2', split: 'dev', seed: { channel_id: 'c2', channel_name: 'MKBHD', subscriber_count: 20_000_000 } },
    { id: 'j2-heldout', lane: 'J2', split: 'heldout', seed: { channel_id: 'c3', channel_name: 'Tested', subscriber_count: 6_000_000 } },
    { id: 'j3-dev-1', lane: 'J3', split: 'dev', seed: { video_id: 'v1', title: 'Laser test', channel_id: 'c1', channel_name: 'Make or Break Shop' } },
    { id: 'j3-heldout-1', lane: 'J3', split: 'heldout', seed: { video_id: 'v2', title: 'Camera test', channel_id: 'c2', channel_name: 'MKBHD' } },
    { id: 'j3-heldout-2', lane: 'J3', split: 'heldout', seed: { video_id: 'v3', title: 'Workshop build', channel_id: 'c3', channel_name: 'Tested' } },
    { id: 'j4-dev-1', lane: 'J4', split: 'dev', query: 'laser engraver' },
    { id: 'j4-dev-2', lane: 'J4', split: 'dev', query: 'woodworking jigs' },
    { id: 'j4-heldout-1', lane: 'J4', split: 'heldout', query: 'air fryer recipes' },
    { id: 'j4-heldout-2', lane: 'J4', split: 'heldout', query: 'budget camera gear' },
    { id: 'j5-dev-1', lane: 'J5', split: 'dev', seed: { channel_id: 'c1', channel_name: 'Make or Break Shop', subscriber_count: 250_000 } },
    { id: 'j5-dev-2', lane: 'J5', split: 'dev', seed: { channel_id: 'c2', channel_name: 'MKBHD', subscriber_count: 20_000_000 } },
    { id: 'j5-heldout-1', lane: 'J5', split: 'heldout', seed: { channel_id: 'c3', channel_name: 'Tested', subscriber_count: 6_000_000 } },
    { id: 'j5-heldout-2', lane: 'J5', split: 'heldout', seed: { channel_id: 'c4', channel_name: 'Epic Gardening', subscriber_count: 3_000_000 } },
  ];
}

const rubrics = {
  J1: { judgment: 'exact target' },
  J2: { scale: '0-3 useful overlap' },
  J3: { scale: '0-3 topic and packaging' },
  J4: { scale: 'binary on-topic valid outlier' },
  J5: { scale: 'creative_adaptation|direct_application|background|none' },
};

describe('semantic v4 corpus contract', () => {
  test('accepts only guarded one-year long-form outliers', () => {
    expect(isEligibleCorpusRow(eligibleRow(), asOf)).toBe(true);

    const rejected: CorpusEligibilityRow[] = [
      eligibleRow({ id: '' }),
      eligibleRow({ channel_id: null }),
      eligibleRow({ title: '   ' }),
      eligibleRow({ published_at: '2025-09-03T15:59:59.000Z' }),
      eligibleRow({ is_short: true }),
      eligibleRow({ duration: 'P0D' }),
      eligibleRow({ is_institutional: true }),
      eligibleRow({ score: 1.99 }),
      eligibleRow({ confidence: 'early' }),
      eligibleRow({ n_baseline: 4 }),
      eligibleRow({ baseline: 4_999 }),
      eligibleRow({ scored_at: '2026-09-03T12:01:00-04:00' }),
    ];

    expect(rejected.every((row) => !isEligibleCorpusRow(row, asOf))).toBe(true);
  });

  test('freezes a sorted, unique entity universe with a reproducible hash', () => {
    const input = {
      version: 4 as const,
      entity_type: 'video' as const,
      as_of: asOf,
      predicate: 'guarded-outlier-v1',
      document_recipe: 'title-channel-clean-description-v1',
      ids: ['video-b', 'video-a'],
      source: { score_model_versions: ['v3.1-semantic-backfill-2026-09'] },
    };
    const manifest = freezeV4CorpusManifest(input);
    expect(manifest.ids).toEqual(['video-a', 'video-b']);
    expect(manifest.entity_count).toBe(2);
    expect(manifest.ids_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(freezeV4CorpusManifest({ ...input, ids: [...input.ids].reverse() }).content_hash)
      .toBe(manifest.content_hash);
    expect(() => freezeV4CorpusManifest({ ...input, ids: ['video-a', 'video-a'] }))
      .toThrow(/duplicate/i);
  });
});

describe('semantic v4 task manifest', () => {
  test('freezes exactly sixteen representative tasks with fixed balanced splits', () => {
    const manifest = freezeV4TaskManifest({ version: 4, as_of: asOf, tasks: tasks(), rubrics });
    expect(() => validateV4TaskManifest(manifest)).not.toThrow();
    expect(manifest.tasks).toHaveLength(16);
    expect(manifest.tasks.filter((task) => task.split === 'dev')).toHaveLength(8);
    expect(manifest.tasks.filter((task) => task.split === 'heldout')).toHaveLength(8);
    expect(manifest.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(freezeV4TaskManifest({ version: 4, as_of: asOf, tasks: tasks(), rubrics }).content_hash)
      .toBe(manifest.content_hash);
  });

  test('rejects the missing-metadata seed failure from revision 3', () => {
    const invalid = tasks();
    invalid[2] = {
      id: 'j2-dev-1', lane: 'J2', split: 'dev',
      seed: { channel_id: 'c1', channel_name: 'Make or Break Shop', subscriber_count: null },
    };
    expect(() => freezeV4TaskManifest({ version: 4, as_of: asOf, tasks: invalid, rubrics }))
      .toThrow(/subscriber_count/i);
  });
});

describe('semantic v4 blind pooling', () => {
  test('deduplicates candidates and strips system, rank, score, and performance fields', () => {
    const pool = buildBlindPool({
      task: tasks()[8],
      salt: 'semantic-v4-test',
      shuffle_seed: 42,
      runs: [
        {
          system: 'lexical_bm25',
          candidates: [
            { entity_id: 'v1', title: 'Laser one', channel_name: 'Channel A', description: 'First', rank: 1, raw_score: 12, score: 4, baseline: 10_000, view_count: 40_000 },
            { entity_id: 'v2', title: 'Laser two', channel_name: 'Channel B', description: 'Second', rank: 2, raw_score: 10, score: 3, baseline: 12_000, view_count: 36_000 },
          ],
        },
        {
          system: 'openai_dense',
          candidates: [
            { entity_id: 'v2', title: 'Laser two', channel_name: 'Channel B', description: 'Second', rank: 1, raw_score: 0.9, score: 3, baseline: 12_000, view_count: 36_000 },
          ],
        },
      ],
    });

    expect(pool.blind).toHaveLength(2);
    expect(new Set(pool.blind.map((candidate) => candidate.entity_id))).toEqual(new Set(['v1', 'v2']));
    for (const candidate of pool.blind) {
      expect(Object.keys(candidate).sort()).toEqual([
        'blind_id', 'channel_name', 'description', 'entity_id', 'task_id', 'title',
      ]);
      expect(JSON.stringify(candidate)).not.toMatch(/system|rank|raw_score|baseline|view_count|"score"/i);
    }
    expect(pool.provenance.v2.map((row) => row.system).sort()).toEqual(['lexical_bm25', 'openai_dense']);

    const repeated = buildBlindPool({
      task: tasks()[8], salt: 'semantic-v4-test', shuffle_seed: 42,
      runs: [{ system: 'lexical_bm25', candidates: [
        { entity_id: 'v1', title: 'Laser one', channel_name: 'Channel A', description: 'First', rank: 1, raw_score: 12 },
        { entity_id: 'v2', title: 'Laser two', channel_name: 'Channel B', description: 'Second', rank: 2, raw_score: 10 },
      ] }],
    });
    expect(repeated.blind.map((candidate: BlindCandidate) => candidate.blind_id))
      .toEqual(pool.blind.map((candidate) => candidate.blind_id));
  });
});

describe('semantic v4 ranking metrics', () => {
  test('reports precision, pooled recall, and nDCG without treating unjudged items as relevant', () => {
    const judgments = { a: 3, b: 0, c: 2, d: 1 };
    expect(precisionAtK(['a', 'b', 'unknown'], judgments, 3)).toBeCloseTo(1 / 3);
    expect(pooledRecallAtK(['a', 'b'], judgments, 2)).toBeCloseTo(1 / 3);
    expect(ndcgAtK(['a', 'c', 'd'], judgments, 3)).toBeCloseTo(1);
    expect(ndcgAtK(['unknown', 'a', 'c'], judgments, 3)).toBeLessThan(1);
  });
});
