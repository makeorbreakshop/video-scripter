/**
 * Simple Pattern Discovery Test
 * Tests the pattern discovery system with mock data
 */

import { PatternDiscoveryService } from './lib/pattern-discovery-service.ts';

// Mock video data for testing
const mockVideos = [
  {
    id: 'vid1',
    title: 'How to Build a Bookshelf for Beginners',
    view_count: 50000,
    rolling_baseline_views: 20000,
    channel_avg_views: 25000,
    published_at: '2024-01-15T10:00:00Z',
    format_type: 'tutorial',
    duration: 'PT15M30S',
    topic_cluster: 'woodworking_beginner'
  },
  {
    id: 'vid2',
    title: 'Beginner Guide to Router Basics',
    view_count: 60000,
    rolling_baseline_views: 25000,
    channel_avg_views: 22000,
    published_at: '2024-01-20T14:30:00Z',
    format_type: 'tutorial',
    duration: 'PT18M20S',
    topic_cluster: 'woodworking_beginner'
  },
  {
    id: 'vid3',
    title: '5 Beginner Mistakes I Made Woodworking',
    view_count: 75000,
    rolling_baseline_views: 15000,
    channel_avg_views: 18000,
    published_at: '2024-01-25T09:15:00Z',
    format_type: 'listicle',
    duration: 'PT12M45S',
    topic_cluster: 'woodworking_beginner'
  },
  {
    id: 'vid4',
    title: 'How to Choose the Right Wood for Beginners',
    view_count: 45000,
    rolling_baseline_views: 20000,
    channel_avg_views: 20000,
    published_at: '2024-02-01T11:00:00Z',
    format_type: 'tutorial',
    duration: 'PT16M15S',
    topic_cluster: 'woodworking_beginner'
  },
  {
    id: 'vid5',
    title: 'Beginner Woodworking Tools You Actually Need',
    view_count: 80000,
    rolling_baseline_views: 30000,
    channel_avg_views: 25000,
    published_at: '2024-02-05T13:45:00Z',
    format_type: 'listicle',
    duration: 'PT14M30S',
    topic_cluster: 'woodworking_beginner'
  }
];

async function runSimpleTest() {
  console.log('🧪 Starting Simple Pattern Discovery Test\n');
  
  try {
    // Test 1: Service initialization
    console.log('📋 Test 1: Service Initialization');
    const service = new PatternDiscoveryService();
    
    if (service && service.analyzers && service.analyzers.length > 0) {
      console.log(`✅ Service initialized with ${service.analyzers.length} analyzers`);
    } else {
      console.log('❌ Service initialization failed');
      return;
    }
    
    // Test 2: Individual analyzer testing
    console.log('\n📋 Test 2: Individual Analyzer Testing');
    const context = {
      topic_cluster: 'woodworking_beginner',
      min_performance: 1.0,
      min_confidence: 0.3,
      min_videos: 2
    };
    
    let totalPatterns = 0;
    
    for (const analyzer of service.analyzers) {
      try {
        const patterns = await analyzer.discover(mockVideos, context);
        console.log(`✅ ${analyzer.constructor.name}: ${patterns.length} patterns found`);
        totalPatterns += patterns.length;
        
        // Show pattern details
        if (patterns.length > 0) {
          const pattern = patterns[0];
          console.log(`   - Pattern: ${pattern.pattern_data.name}`);
          console.log(`   - Confidence: ${pattern.confidence.toFixed(2)}`);
          console.log(`   - Evidence: ${pattern.evidence_count} videos`);
        }
      } catch (error) {
        console.log(`❌ ${analyzer.constructor.name}: ${error.message}`);
      }
    }
    
    console.log(`\n📊 Total patterns discovered: ${totalPatterns}`);
    
    // Test 3: Pattern validation
    console.log('\n📋 Test 3: Pattern Validation');
    
    const testPattern = {
      pattern_type: 'title',
      pattern_data: { name: 'Test Pattern' },
      performance_stats: { avg: 2.5, median: 2.0, variance: 0.5 },
      confidence: 0.9,
      evidence_count: 50,
      videos_analyzed: ['vid1', 'vid2']
    };
    
    const isValid = await service.validatePattern(testPattern);
    console.log(`✅ Pattern validation: ${isValid ? 'PASS' : 'FAIL'}`);
    
    // Test 4: Full discovery workflow (with relaxed parameters)
    console.log('\n📋 Test 4: Full Discovery Workflow');
    
    const relaxedContext = {
      topic_cluster: 'woodworking_beginner',
      min_performance: 1.2,
      min_confidence: 0.1,
      min_videos: 3
    };
    
    // Override the getHighPerformingVideos method to use our mock data
    const originalMethod = service.getHighPerformingVideos;
    service.getHighPerformingVideos = async (context) => {
      return mockVideos.filter(video => {
        const baselineViews = video.rolling_baseline_views || video.channel_avg_views || 1;
        const performanceRatio = video.view_count / baselineViews;
        return performanceRatio >= context.min_performance;
      });
    };
    
    try {
      const patterns = await service.discoverPatternsInCluster(relaxedContext);
      console.log(`✅ Full workflow: ${patterns.length} patterns discovered`);
      
      if (patterns.length > 0) {
        console.log('\n🎯 Sample Pattern Details:');
        const pattern = patterns[0];
        console.log(`   - Type: ${pattern.pattern_type}`);
        console.log(`   - Name: ${pattern.pattern_data.name}`);
        console.log(`   - Confidence: ${pattern.confidence.toFixed(2)}`);
        console.log(`   - Evidence: ${pattern.evidence_count} videos`);
        console.log(`   - Performance: ${pattern.performance_stats.avg.toFixed(2)}x average`);
      }
    } catch (error) {
      console.log(`❌ Full workflow failed: ${error.message}`);
    }
    
    console.log('\n🎉 Simple Pattern Discovery Test Complete!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
runSimpleTest().catch(console.error);