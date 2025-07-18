import { TestFixtures } from '../helpers/fixtures';

// DBSCAN implementation tests
describe('DBSCAN Clustering Algorithm', () => {
  // Test implementation of DBSCAN since the actual function is not exported
  function dbscan(
    videos: { embedding?: number[] }[], 
    epsilon: number = 0.15, 
    minPoints: number = 3
  ): number[] {
    const n = videos.length;
    const labels = new Array(n).fill(-1);
    let clusterId = 0;
    
    const distance = (a: number[], b: number[]): number => {
      if (!a || !b || a.length !== b.length) return Infinity;
      return 1 - cosineSimilarity(a, b);
    };
    
    const findNeighbors = (idx: number): number[] => {
      const neighbors: number[] = [];
      const video = videos[idx];
      if (!video.embedding) return neighbors;
      
      for (let i = 0; i < n; i++) {
        if (i === idx) continue;
        if (!videos[i].embedding) continue;
        
        const dist = distance(video.embedding, videos[i].embedding!);
        if (dist <= epsilon) {
          neighbors.push(i);
        }
      }
      return neighbors;
    };
    
    for (let i = 0; i < n; i++) {
      if (labels[i] !== -1) continue;
      if (!videos[i].embedding) continue;
      
      const neighbors = findNeighbors(i);
      if (neighbors.length < minPoints - 1) {
        // Mark as noise
        labels[i] = -1;
        continue;
      }
      
      labels[i] = clusterId;
      const seeds = [...neighbors];
      
      while (seeds.length > 0) {
        const currentIdx = seeds.shift()!;
        if (labels[currentIdx] === -1) {
          labels[currentIdx] = clusterId;
        }
        if (labels[currentIdx] !== undefined && labels[currentIdx] >= 0) continue;
        
        labels[currentIdx] = clusterId;
        const currentNeighbors = findNeighbors(currentIdx);
        if (currentNeighbors.length >= minPoints - 1) {
          seeds.push(...currentNeighbors.filter(idx => labels[idx] === -1));
        }
      }
      
      clusterId++;
    }
    
    return labels;
  }

  function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  describe('Basic clustering', () => {
    it('should cluster videos with 85% similarity (epsilon=0.15)', () => {
      // Create embeddings with known similarities
      const baseEmbedding = TestFixtures.generateMockEmbedding(512, 1);
      
      // Create similar embeddings (>85% similarity)
      const similarEmbedding1 = baseEmbedding.map(v => v * 0.95 + Math.random() * 0.05);
      const similarEmbedding2 = baseEmbedding.map(v => v * 0.93 + Math.random() * 0.07);
      
      // Create dissimilar embedding
      const dissimilarEmbedding = TestFixtures.generateMockEmbedding(512, 99);
      
      const videos = [
        { embedding: baseEmbedding },
        { embedding: similarEmbedding1 },
        { embedding: similarEmbedding2 },
        { embedding: dissimilarEmbedding },
      ];
      
      const labels = dbscan(videos, 0.15, 2);
      
      // First three should be in the same cluster
      expect(labels[0]).toBe(labels[1]);
      expect(labels[1]).toBe(labels[2]);
      expect(labels[0]).toBeGreaterThanOrEqual(0);
      
      // Fourth should be noise or different cluster
      expect(labels[3]).not.toBe(labels[0]);
    });

    it('should require minimum points for cluster formation', () => {
      const videos = [
        { embedding: [1, 0, 0] },
        { embedding: [0.95, 0.05, 0] }, // Close to first
      ];
      
      // With minPoints=3, these should be noise
      const labels = dbscan(videos, 0.15, 3);
      expect(labels[0]).toBe(-1);
      expect(labels[1]).toBe(-1);
      
      // With minPoints=2, they should cluster
      const labels2 = dbscan(videos, 0.15, 2);
      expect(labels2[0]).toBe(0);
      expect(labels2[1]).toBe(0);
    });

    it('should handle videos without embeddings', () => {
      const videos = [
        { embedding: [1, 0, 0] },
        { embedding: undefined },
        { embedding: [0.95, 0.05, 0] },
        { embedding: undefined },
      ];
      
      const labels = dbscan(videos, 0.15, 2);
      
      // Videos without embeddings should remain as noise
      expect(labels[1]).toBe(-1);
      expect(labels[3]).toBe(-1);
      
      // Videos with embeddings can still cluster
      expect(labels[0]).toBe(labels[2]);
      expect(labels[0]).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Complex clustering scenarios', () => {
    it('should identify multiple distinct clusters', () => {
      // Create 3 distinct groups
      const group1 = Array(4).fill(null).map(() => 
        TestFixtures.generateMockEmbedding(512, 1).map(v => v + Math.random() * 0.05)
      );
      const group2 = Array(4).fill(null).map(() => 
        TestFixtures.generateMockEmbedding(512, 2).map(v => v + Math.random() * 0.05)
      );
      const group3 = Array(4).fill(null).map(() => 
        TestFixtures.generateMockEmbedding(512, 3).map(v => v + Math.random() * 0.05)
      );
      
      const videos = [
        ...group1.map(e => ({ embedding: e })),
        ...group2.map(e => ({ embedding: e })),
        ...group3.map(e => ({ embedding: e })),
      ];
      
      const labels = dbscan(videos, 0.15, 3);
      
      // Should have 3 distinct clusters
      const uniqueLabels = new Set(labels.filter(l => l >= 0));
      expect(uniqueLabels.size).toBe(3);
      
      // Each group should have the same label
      expect(new Set(labels.slice(0, 4)).size).toBe(1);
      expect(new Set(labels.slice(4, 8)).size).toBe(1);
      expect(new Set(labels.slice(8, 12)).size).toBe(1);
    });

    it('should handle edge cases with border points', () => {
      // Create a chain of videos where each is similar to neighbors
      const videos = Array(5).fill(null).map((_, i) => ({
        embedding: TestFixtures.generateMockEmbedding(512, i * 0.1)
      }));
      
      // Adjust embeddings to create a chain
      for (let i = 1; i < videos.length; i++) {
        videos[i].embedding = videos[i-1].embedding.map(v => v * 0.9 + Math.random() * 0.1);
      }
      
      const labels = dbscan(videos, 0.15, 2);
      
      // Should form one cluster if chain is connected
      const uniqueLabels = new Set(labels.filter(l => l >= 0));
      expect(uniqueLabels.size).toBeGreaterThanOrEqual(1);
    });

    it('should handle high-dimensional sparse embeddings', () => {
      // Test with realistic 512-dimensional embeddings
      // Create some videos that will cluster and some that won't
      const clusteredVideos = Array(5).fill(null).map((_, i) => ({
        embedding: TestFixtures.generateMockEmbedding(512, 1).map(v => v + Math.random() * 0.05)
      }));
      
      const sparseVideos = Array(15).fill(null).map((_, i) => ({
        embedding: TestFixtures.generateMockEmbedding(512, i + 10)
      }));
      
      const videos = [...clusteredVideos, ...sparseVideos];
      
      const labels = dbscan(videos, 0.25, 3);
      
      // Should produce at least one cluster and some noise
      const clusters = labels.filter(l => l >= 0);
      const noise = labels.filter(l => l === -1);
      
      expect(clusters.length).toBeGreaterThanOrEqual(3); // At least 3 videos clustered
      expect(noise.length).toBeGreaterThan(0);
    });
  });

  describe('Performance considerations', () => {
    it('should handle large datasets efficiently', () => {
      const startTime = Date.now();
      
      // Create 100 videos
      const videos = Array(100).fill(null).map((_, i) => ({
        embedding: TestFixtures.generateMockEmbedding(512, Math.floor(i / 10))
      }));
      
      const labels = dbscan(videos, 0.15, 3);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete in reasonable time (< 1 second for 100 videos)
      expect(duration).toBeLessThan(1000);
      
      // Should produce multiple clusters
      const uniqueLabels = new Set(labels.filter(l => l >= 0));
      expect(uniqueLabels.size).toBeGreaterThan(5);
    });
  });
});