import { PineconeService } from '../../lib/pinecone-service';
import { Pinecone } from '@pinecone-database/pinecone';

// Mock the Pinecone SDK
jest.mock('@pinecone-database/pinecone');

// Mock Supabase with chainable query builder
const createMockQueryBuilder = (data: any[] = [], error: any = null) => {
  const queryBuilder: any = {
    select: jest.fn(() => queryBuilder),
    in: jest.fn(() => queryBuilder),
    not: jest.fn(() => queryBuilder),
    gte: jest.fn(() => queryBuilder),
    gt: jest.fn(() => queryBuilder),
    limit: jest.fn(() => queryBuilder),
    eq: jest.fn(() => queryBuilder),
    // Terminal method that returns a promise
    then: (resolve: any, reject: any) => Promise.resolve({ data, error }).then(resolve, reject),
  };
  return queryBuilder;
};

// Mock video database
const mockVideos = new Map<string, any>();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table: string) => {
      const queryBuilder = createMockQueryBuilder();
      
      // Override the in() method to filter by video IDs
      const originalIn = queryBuilder.in;
      queryBuilder.in = jest.fn((column: string, values: string[]) => {
        if (table === 'videos' && column === 'id') {
          // Filter mock videos by the requested IDs
          const filteredVideos = values
            .map(id => mockVideos.get(id))
            .filter(Boolean);
          
          // Update the queryBuilder to return filtered data
          queryBuilder.then = (resolve: any) => 
            Promise.resolve({ data: filteredVideos, error: null }).then(resolve);
        }
        return originalIn(column, values);
      });
      
      // For channel baseline queries
      if (table === 'videos' && queryBuilder.select.mock.calls.length > 0 && 
          queryBuilder.select.mock.calls[0][0] === 'channel_id, view_count') {
        const channelData = Array.from(mockVideos.values()).map(v => ({
          channel_id: v.channel_id,
          view_count: v.view_count
        }));
        queryBuilder.then = (resolve: any) => 
          Promise.resolve({ data: channelData, error: null }).then(resolve);
      }
      
      return queryBuilder;
    }),
  })),
}));

describe('PineconeService', () => {
  let pineconeService: PineconeService;
  let mockIndex: any;
  let mockPinecone: jest.Mocked<Pinecone>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockVideos.clear();
    
    // Setup mock index
    mockIndex = {
      describeIndexStats: jest.fn(),
      upsert: jest.fn(),
      query: jest.fn(),
      deleteMany: jest.fn(),
      fetch: jest.fn(),
    };

    // Setup mock Pinecone instance
    mockPinecone = {
      index: jest.fn(() => mockIndex),
    } as any;

    (Pinecone as jest.MockedClass<typeof Pinecone>).mockImplementation(() => mockPinecone);

    pineconeService = new PineconeService();
  });

  describe('initialization', () => {
    it('should initialize only once for concurrent requests', async () => {
      const stats = {
        totalRecordCount: 100,
        dimension: 512,
        indexFullness: 0.1,
        namespaces: {},
      };
      mockIndex.describeIndexStats.mockResolvedValue(stats);

      // Call initializeIndex multiple times concurrently
      const promises = Array(5).fill(null).map(() => pineconeService.initializeIndex());
      await Promise.all(promises);

      // Should only call describeIndexStats once
      expect(mockIndex.describeIndexStats).toHaveBeenCalledTimes(1);
    });

    it('should handle missing vector count gracefully', async () => {
      const stats = {
        dimension: 512,
        indexFullness: 0.1,
        namespaces: {},
      };
      mockIndex.describeIndexStats.mockResolvedValue(stats);

      await pineconeService.initializeIndex();

      // Should not throw and should handle missing totalRecordCount
      expect(mockIndex.describeIndexStats).toHaveBeenCalledTimes(1);
    });

    it('should retry initialization after failure', async () => {
      // First call fails
      mockIndex.describeIndexStats.mockRejectedValueOnce(new Error('Connection failed'));
      
      // Second call succeeds
      const stats = {
        totalRecordCount: 100,
        dimension: 512,
        indexFullness: 0.1,
        namespaces: {},
      };
      mockIndex.describeIndexStats.mockResolvedValueOnce(stats);

      // First initialization should fail
      await expect(pineconeService.initializeIndex()).rejects.toThrow('Connection failed');
      
      // Second initialization should succeed
      await expect(pineconeService.initializeIndex()).resolves.not.toThrow();
      
      expect(mockIndex.describeIndexStats).toHaveBeenCalledTimes(2);
    });
  });

  describe('searchSimilar', () => {
    beforeEach(async () => {
      // Initialize the service
      const stats = {
        totalRecordCount: 100,
        dimension: 512,
        indexFullness: 0.1,
        namespaces: {},
      };
      mockIndex.describeIndexStats.mockResolvedValue(stats);
      await pineconeService.initializeIndex();
    });

    it('should return embeddings with search results', async () => {
      const mockEmbedding = new Array(512).fill(0.1);
      
      // Set up mock videos
      mockVideos.set('video1', {
        id: 'video1',
        title: 'Test Video 1',
        channel_id: 'channel1',
        channel_name: 'Channel 1',
        view_count: 1000,
        published_at: '2024-01-01',
        thumbnail_url: 'https://example.com/thumb1.jpg',
        duration: 'PT10M',
      });
      mockVideos.set('video2', {
        id: 'video2',
        title: 'Test Video 2',
        channel_id: 'channel2',
        channel_name: 'Channel 2',
        view_count: 2000,
        published_at: '2024-01-02',
        thumbnail_url: 'https://example.com/thumb2.jpg',
        duration: 'PT15M',
      });
      
      const mockMatches = [
        {
          id: 'video1',
          score: 0.9,
          values: mockEmbedding,
          metadata: {
            title: 'Test Video 1',
            channel_id: 'channel1',
            view_count: 1000,
            published_at: '2024-01-01',
            performance_ratio: 1.5,
          },
        },
        {
          id: 'video2',
          score: 0.8,
          values: mockEmbedding,
          metadata: {
            title: 'Test Video 2',
            channel_id: 'channel2',
            view_count: 2000,
            published_at: '2024-01-02',
            performance_ratio: 2.0,
          },
        },
      ];

      mockIndex.query.mockResolvedValue({
        matches: mockMatches,
      });

      const result = await pineconeService.searchSimilar(mockEmbedding, 10, 0.7);

      expect(result.results).toHaveLength(2);
      expect(result.results[0].embedding).toBeDefined();
      expect(result.results[0].embedding).toHaveLength(512);
      expect(result.results[0].similarity_score).toBe(0.9);
    });

    it('should filter results by minimum score', async () => {
      const mockEmbedding = new Array(512).fill(0.1);
      
      // Set up mock videos
      mockVideos.set('video1', {
        id: 'video1',
        title: 'Test Video 1',
        channel_id: 'channel1',
        channel_name: 'Channel 1',
        view_count: 1000,
        published_at: '2024-01-01',
        thumbnail_url: 'https://example.com/thumb1.jpg',
        duration: 'PT10M',
      });
      mockVideos.set('video3', {
        id: 'video3',
        title: 'Test Video 3',
        channel_id: 'channel1',
        channel_name: 'Channel 1',
        view_count: 3000,
        published_at: '2024-01-03',
        thumbnail_url: 'https://example.com/thumb3.jpg',
        duration: 'PT20M',
      });
      
      const mockMatches = [
        { id: 'video1', score: 0.9, values: mockEmbedding },
        { id: 'video2', score: 0.65, values: mockEmbedding }, // Below threshold
        { id: 'video3', score: 0.8, values: mockEmbedding },
      ];

      mockIndex.query.mockResolvedValue({
        matches: mockMatches,
      });

      const result = await pineconeService.searchSimilar(mockEmbedding, 10, 0.7);

      expect(result.results).toHaveLength(2);
      expect(result.results.every(r => r.similarity_score >= 0.7)).toBe(true);
    });

    it('should handle pagination correctly', async () => {
      const mockEmbedding = new Array(512).fill(0.1);
      
      // Set up 25 mock videos
      for (let i = 0; i < 25; i++) {
        mockVideos.set(`video${i}`, {
          id: `video${i}`,
          title: `Test Video ${i}`,
          channel_id: `channel${i % 5}`, // 5 different channels
          channel_name: `Channel ${i % 5}`,
          view_count: 1000 + (i * 100),
          published_at: '2024-01-01',
          thumbnail_url: `https://example.com/thumb${i}.jpg`,
          duration: 'PT10M',
        });
      }
      
      const mockMatches = Array(25).fill(null).map((_, i) => ({
        id: `video${i}`,
        score: 0.9 - (i * 0.01),
        values: mockEmbedding,
      }));

      mockIndex.query.mockResolvedValue({
        matches: mockMatches,
      });

      // First page
      const page1 = await pineconeService.searchSimilar(mockEmbedding, 10, 0.7, 0);
      expect(page1.results).toHaveLength(10);
      expect(page1.hasMore).toBe(true);
      // Score range: 0.90 to 0.66, so 21 videos have score >= 0.7 (indices 0-20)
      expect(page1.totalAvailable).toBe(21);

      // Second page
      const page2 = await pineconeService.searchSimilar(mockEmbedding, 10, 0.7, 10);
      expect(page2.results).toHaveLength(10);
      expect(page2.hasMore).toBe(true);

      // Third page (partial)
      const page3 = await pineconeService.searchSimilar(mockEmbedding, 10, 0.7, 20);
      expect(page3.results).toHaveLength(1); // Only 1 video left
      expect(page3.hasMore).toBe(false);
    });
  });

  describe('getIndexStats', () => {
    beforeEach(async () => {
      // Initialize the service
      const stats = {
        totalRecordCount: 100,
        dimension: 512,
        indexFullness: 0.1,
        namespaces: {},
      };
      mockIndex.describeIndexStats.mockResolvedValue(stats);
      await pineconeService.initializeIndex();
    });

    it('should return index statistics with backward compatibility', async () => {
      const mockStats = {
        totalRecordCount: 1000,
        dimension: 512,
        indexFullness: 0.5,
        namespaces: { '': { recordCount: 1000 } },
      };

      mockIndex.describeIndexStats.mockResolvedValue(mockStats);

      const stats = await pineconeService.getIndexStats();

      expect(stats.totalVectorCount).toBe(1000); // Backward compatibility
      expect(stats.totalRecordCount).toBe(1000);
      expect(stats.dimension).toBe(512);
      expect(stats.indexFullness).toBe(0.5);
    });
  });
});