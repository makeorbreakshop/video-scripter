import fs from 'fs';
import path from 'path';

export class TestFixtures {
  private static fixturesPath = path.join(__dirname, '../fixtures');

  static loadEmbeddings() {
    const data = JSON.parse(
      fs.readFileSync(path.join(this.fixturesPath, 'embeddings.json'), 'utf-8')
    );
    return data.embeddings;
  }

  static loadVideos() {
    return JSON.parse(
      fs.readFileSync(path.join(this.fixturesPath, 'videos.json'), 'utf-8')
    );
  }

  static loadPatterns() {
    return JSON.parse(
      fs.readFileSync(path.join(this.fixturesPath, 'patterns.json'), 'utf-8')
    );
  }

  static loadClusters() {
    return JSON.parse(
      fs.readFileSync(path.join(this.fixturesPath, 'clusters.json'), 'utf-8')
    );
  }

  static generateMockEmbedding(dimension: number = 512, seed?: number): number[] {
    // Use a seed for consistent test results if provided
    const random = seed ? this.seededRandom(seed) : Math.random;
    return Array(dimension).fill(0).map(() => random() * 0.4 - 0.2);
  }

  private static seededRandom(seed: number) {
    return function() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  static generateMockVideo(overrides: Partial<any> = {}) {
    const id = overrides.id || `video_${Math.random().toString(36).substr(2, 9)}`;
    return {
      id,
      title: 'Test Video Title',
      channel_id: 'channel_test',
      channel_name: 'Test Channel',
      view_count: 100000,
      published_at: new Date().toISOString(),
      performance_ratio: 2.5,
      thumbnail_url: 'https://example.com/thumb.jpg',
      duration: 'PT10M',
      ...overrides,
    };
  }

  static generateMockPattern(overrides: Partial<any> = {}) {
    return {
      pattern: 'Test Pattern',
      pattern_type: 'DEEP',
      explanation: 'This is a test pattern',
      template: '[Number] [Items] for [Audience]',
      examples: ['5 Tools for Beginners', '7 Tips for Woodworkers'],
      video_ids: ['video_001', 'video_002'],
      confidence: 0.8,
      performance_multiplier: 3.5,
      sample_size: 10,
      ...overrides,
    };
  }

  static generateMockCluster(overrides: Partial<any> = {}) {
    return {
      cluster_id: '0',
      size: 10,
      thread_overlap: 2,
      avg_performance: 3.5,
      is_wide: false,
      videos: [
        this.generateMockVideo({ id: 'cluster_video_1' }),
        this.generateMockVideo({ id: 'cluster_video_2' }),
      ],
      dominant_themes: ['test', 'mock'],
      thread_sources: ['thread1', 'thread2'],
      ...overrides,
    };
  }
}