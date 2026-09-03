import {
  buildChannelDocument,
  buildVideoDocument,
  docHash,
  mapChannelPayload,
  mapVideoPayload,
} from './documents';

describe('semantic documents', () => {
  test('builds the exact default video document from title, channel, and niche', () => {
    expect(buildVideoDocument({
      title: 'A Lazy Weeknight Dinner',
      channelName: 'Allrecipes',
      topicNiche: 'Air Fryer Recipes',
      description: 'Ignored by the default.',
    })).toBe('A Lazy Weeknight Dinner\nAllrecipes\nAir Fryer Recipes');

    expect(buildVideoDocument({
      title: 'Untitled niche', channelName: 'Maker', topicNiche: null,
    })).toBe('Untitled niche\nMaker\n');
  });

  test('supports the title-only and 300-character description experiment variants', () => {
    const description = 'x'.repeat(320);
    const input = { title: 'Test', channelName: 'Channel', topicNiche: 'Niche', description };
    expect(buildVideoDocument(input, 'title')).toBe('Test');
    expect(buildVideoDocument(input, 'description')).toBe(`Test\n${'x'.repeat(300)}`);
  });

  test('builds a channel document from its name, 20 most-viewed titles, and top three niches', () => {
    const videos = Array.from({ length: 22 }, (_, index) => ({
      title: `Video ${index}`,
      viewCount: index * 100,
      publishedAt: new Date(2026, 7, index + 1),
      topicNiche: index < 8 ? 'Laser Cutting' : index < 14 ? 'Woodworking' : index < 18 ? '3D Printing' : 'Other',
    }));

    const lines = buildChannelDocument({ name: 'Maker Channel', videos }).split('\n');
    expect(lines[0]).toBe('Maker Channel');
    expect(lines.slice(1, 21)).toEqual(Array.from({ length: 20 }, (_, i) => `Video ${21 - i}`));
    expect(lines.slice(21)).toEqual(['Laser Cutting', 'Woodworking', '3D Printing']);
  });

  test('falls back to the 20 newest uploads when view counts are unavailable', () => {
    const videos = Array.from({ length: 22 }, (_, index) => ({
      title: `Upload ${index}`,
      viewCount: null,
      publishedAt: new Date(2026, 7, index + 1),
      topicNiche: null,
    }));
    expect(buildChannelDocument({ name: 'Fallback', videos }, { includeNiches: false }).split('\n').slice(1))
      .toEqual(Array.from({ length: 20 }, (_, i) => `Upload ${21 - i}`));
  });

  test('hashes documents deterministically', () => {
    expect(docHash('same')).toBe(docHash('same'));
    expect(docHash('same')).not.toBe(docHash('different'));
    expect(docHash('same')).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('semantic payload mapping', () => {
  test('maps a video payload and derives unix time and outlier status', () => {
    expect(mapVideoPayload({
      id: 'v1', channel_id: 'c1', channel_name: 'Channel', title: 'Title',
      published_at: new Date('2026-09-02T12:00:00Z'), view_count: '123',
      topic_domain: 'How-to', topic_niche: 'Laser', topic_micro: null, format_type: 'tutorial',
      score: '2.5', confidence: 'likely', est30: '5000', baseline: '2000',
    }, '2026-09-02T13:00:00.000Z')).toEqual({
      video_id: 'v1', channel_id: 'c1', channel_name: 'Channel', title: 'Title',
      published_at: 1788350400, view_count: 123, topic_domain: 'How-to', topic_niche: 'Laser',
      topic_micro: null, format_type: 'tutorial', score: 2.5, confidence: 'likely',
      est30: 5000, baseline: 2000, is_outlier: true, embedded_at: '2026-09-02T13:00:00.000Z',
    });
  });

  test('maps a channel payload without losing null numeric values', () => {
    expect(mapChannelPayload({
      channel_id: 'c1', name: 'Channel', subscriber_count: null, video_count: '12',
      top_niches: ['Laser', 'Wood'], baseline: null, outlier_rate: '0.25', lane: 'corpus',
    }, '2026-09-02T13:00:00.000Z')).toEqual({
      channel_id: 'c1', name: 'Channel', subscriber_count: null, video_count: 12,
      top_niches: ['Laser', 'Wood'], baseline: null, outlier_rate: 0.25,
      lane: 'corpus', embedded_at: '2026-09-02T13:00:00.000Z',
    });
  });
});
