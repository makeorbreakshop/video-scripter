import {
  mapThumbnailPayload,
  selectThumbnailCohort,
  summarizeThumbnailRetrieval,
  thumbnailCollectionConfig,
  thumbnailQueryBody,
  validateThumbnailEmbeddingOutput,
  type ThumbnailCandidate,
} from './thumbnails';

function candidate(overrides: Partial<ThumbnailCandidate> & Pick<ThumbnailCandidate, 'videoId'>): ThumbnailCandidate {
  const index = Number(overrides.videoId.replace(/\D/g, '')) || 0;
  return {
    videoId: overrides.videoId,
    channelId: `channel-${index % 4}`,
    channelName: `Channel ${index % 4}`,
    title: `Video ${index}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${overrides.videoId}/hqdefault.jpg`,
    publishedAt: 1_788_350_400 + index,
    topicDomain: `domain-${index % 3}`,
    topicNiche: `niche-${index % 5}`,
    topicMicro: null,
    formatType: index % 2 ? 'tutorial' : 'review',
    score: index % 3 ? 1.1 : 2.5,
    confidence: index % 3 ? 'possible' : 'confirmed',
    isOutlier: index % 3 === 0,
    subscriberCount: [5_000, 50_000, 500_000, 5_000_000][index % 4],
    ...overrides,
  };
}

describe('thumbnail cohort selection', () => {
  test('is input-order independent, stratified, and capped per channel', () => {
    const candidates = Array.from({ length: 48 }, (_, index) => candidate({ videoId: `v${index + 1}` }));
    const options = { limit: 12, maxPerChannel: 3, seed: 'fixed' };
    const first = selectThumbnailCohort(candidates, options);
    const second = selectThumbnailCohort([...candidates].reverse(), options);

    expect(second.map((item) => item.videoId)).toEqual(first.map((item) => item.videoId));
    expect(first).toHaveLength(12);
    const counts = new Map<string, number>();
    for (const item of first) counts.set(item.channelId, (counts.get(item.channelId) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
    expect(new Set(first.map((item) => `${item.topicDomain}:${item.formatType}:${item.isOutlier}`)).size)
      .toBeGreaterThan(5);
  });

  test('preserves an available forced test video and removes invalid or duplicate candidates', () => {
    const selected = selectThumbnailCohort([
      candidate({ videoId: 'v1' }),
      candidate({ videoId: 'v1', title: 'duplicate' }),
      candidate({ videoId: 'MpGDoiSH_PQ', channelId: 'test-channel' }),
      candidate({ videoId: 'bad', thumbnailUrl: '' }),
      candidate({ videoId: 'v2' }),
    ], { limit: 2, maxPerChannel: 1, seed: 'fixed', forcedIds: ['MpGDoiSH_PQ'] });

    expect(selected.map((item) => item.videoId)).toContain('MpGDoiSH_PQ');
    expect(new Set(selected.map((item) => item.videoId)).size).toBe(selected.length);
    expect(selected.every((item) => item.thumbnailUrl.startsWith('https://'))).toBe(true);
  });
});

describe('thumbnail payload and Qdrant contracts', () => {
  test('maps provenance without converting absent numbers to zero', () => {
    expect(mapThumbnailPayload(candidate({
      videoId: 'v1', score: null, subscriberCount: null, publishedAt: 1_788_350_400,
    }), {
      perceptualHash: 'abcdef0123456789',
      contentSha256: 'a'.repeat(64),
      model: 'tencent/WeMM-Embedding-4B',
      modelRevision: 'a28b25c5d18cf71ec46b115e06ea79ab00ee4819',
      preprocessing: 'exif-rgb-fit-640x640-jpeg95',
      dimensions: 512,
      embeddedAt: '2026-09-02T12:00:00.000Z',
      linkedVideoIds: ['v1', 'v2'],
    })).toMatchObject({
      video_id: 'v1',
      linked_video_ids: ['v1', 'v2'],
      published_at: 1_788_350_400,
      score: null,
      subscriber_count: null,
      channel_size_band: 'unknown',
      perceptual_hash: 'abcdef0123456789',
      content_sha256: 'a'.repeat(64),
      embedding_model: 'tencent/WeMM-Embedding-4B',
      embedding_model_revision: 'a28b25c5d18cf71ec46b115e06ea79ab00ee4819',
      embedding_preprocessing: 'exif-rgb-fit-640x640-jpeg95',
      embedding_dimensions: 512,
      embedded_at: '2026-09-02T12:00:00.000Z',
    });
  });

  test('creates two independent 512-dimensional cosine representations', () => {
    expect(thumbnailCollectionConfig(512)).toEqual({
      vectors: {
        visual: { size: 512, distance: 'Cosine' },
        visual_title: { size: 512, distance: 'Cosine' },
      },
      on_disk_payload: true,
    });
  });

  test('queries a named representation without mixing the vectors', () => {
    expect(thumbnailQueryBody([0.1, 0.2], 'visual_title', 10)).toEqual({
      query: [0.1, 0.2],
      using: 'visual_title',
      limit: 10,
      with_payload: true,
      with_vector: false,
    });
  });

  test('accepts finite, normalized worker output and rejects malformed vectors', () => {
    const valid = {
      model: 'tencent/WeMM-Embedding-4B',
      modelRevision: 'a28b25c5d18cf71ec46b115e06ea79ab00ee4819',
      preprocessing: 'exif-rgb-fit-640x640-jpeg95',
      dimensions: 2,
      device: 'mps',
      downloads: 2,
      failures: [{ videoId: 'v2', reason: 'HTTP 404' }],
      rows: [{
        candidate: candidate({ videoId: 'v1' }),
        linkedVideoIds: ['v1'],
        perceptualHash: '0123456789abcdef',
        contentSha256: 'a'.repeat(64),
        visual: [0.6, 0.8],
        visualTitle: [0, 1],
      }],
    };

    expect(validateThumbnailEmbeddingOutput(valid, 2)).toMatchObject({ device: 'mps', downloads: 2 });
    expect(() => validateThumbnailEmbeddingOutput({
      ...valid,
      rows: [{ ...valid.rows[0], visual: [0.6, Number.NaN] }],
    }, 2)).toThrow('visual');
    expect(() => validateThumbnailEmbeddingOutput({
      ...valid,
      rows: [{ ...valid.rows[0], visualTitle: [1] }],
    }, 2)).toThrow('visualTitle');
  });

  test('summarizes representation overlap without treating cosine as a relevance label', () => {
    expect(summarizeThumbnailRetrieval([{
      seedChannelId: 'seed-channel',
      seedTitle: 'Laser engraver buying guide',
      visual: [
        { id: 'a', channelId: 'other', title: 'Workshop lighting setup', score: 0.9 },
        { id: 'b', channelId: 'seed-channel', title: 'Camera review', score: 0.8 },
      ],
      visualTitle: [
        { id: 'b', channelId: 'seed-channel', title: 'Camera review', score: 0.95 },
        { id: 'c', channelId: 'other-2', title: 'Best laser engraver review', score: 0.85 },
      ],
    }])).toEqual({
      seeds: 1,
      overlapAtK: 0.5,
      visual: { crossChannelRate: 0.5, meanTitleTokenOverlap: 0 },
      visualTitle: { crossChannelRate: 0.5, meanTitleTokenOverlap: 0.1667 },
    });
  });
});
