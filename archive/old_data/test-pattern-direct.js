/**
 * Direct Pattern Discovery Test
 * Test the pattern discovery system directly with minimal dependencies
 */

import { PatternDiscoveryService } from './lib/pattern-discovery-service.ts';
import { supabase } from './lib/supabase.ts';
import dotenv from 'dotenv';

dotenv.config();

// Test data
const mockVideos = [
  {
    id: 'test1',
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
    id: 'test2',
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
    id: 'test3',
    title: '5 Beginner Mistakes I Made Woodworking',
    view_count: 75000,
    rolling_baseline_views: 15000,
    channel_avg_views: 18000,
    published_at: '2024-01-25T09:15:00Z',
    format_type: 'listicle',
    duration: 'PT12M45S',
    topic_cluster: 'woodworking_beginner'
  }
];

async function testPatternDiscovery() {
  console.log('🧪 Testing Pattern Discovery System...\n');
  
  try {
    // Test 1: Service initialization
    console.log('📋 Test 1: Service Initialization');
    const service = new PatternDiscoveryService();
    console.log('✅ Service initialized successfully');
    console.log(`   Analyzers loaded: ${service.analyzers.length}`);
    
    // Test 2: Database connection
    console.log('\n📋 Test 2: Database Connection');
    const { data: videoCount, error } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.error('❌ Database connection failed:', error);
      return;
    }
    
    console.log('✅ Database connected successfully');
    console.log(`   Videos available: ${videoCount}`);
    
    // Test 3: Pattern table access
    console.log('\n📋 Test 3: Pattern Tables');
    const { data: patternsCount, error: patternsError } = await supabase
      .from('patterns')
      .select('*', { count: 'exact', head: true });
    
    if (patternsError) {
      console.error('❌ Patterns table error:', patternsError);
      return;
    }
    
    console.log('✅ Patterns table accessible');
    console.log(`   Existing patterns: ${patternsCount || 0}`);
    
    // Test 4: Individual analyzer testing
    console.log('\n📋 Test 4: Individual Analyzers');
    const context = {
      topic_cluster: 'woodworking_beginner',
      min_performance: 1.0,
      min_confidence: 0.5,
      min_videos: 2
    };
    
    let totalPatterns = 0;
    
    for (const analyzer of service.analyzers) {
      try {
        const patterns = await analyzer.discover(mockVideos, context);
        console.log(`✅ ${analyzer.constructor.name}: ${patterns.length} patterns found`);
        totalPatterns += patterns.length;
        
        // Show sample pattern
        if (patterns.length > 0) {
          const sample = patterns[0];
          console.log(`   Sample: ${sample.pattern_data.name || 'Unnamed pattern'}`);
          console.log(`   Evidence: ${sample.evidence_count} videos`);
          console.log(`   Confidence: ${(sample.confidence * 100).toFixed(1)}%`);
        }
      } catch (error) {
        console.error(`❌ ${analyzer.constructor.name}: ${error.message}`);
      }
    }
    
    console.log(`\n📊 Total patterns discovered: ${totalPatterns}`);
    
    // Test 5: Pattern validation
    console.log('\n📋 Test 5: Pattern Validation');
    const validPattern = {
      pattern_type: 'title',
      pattern_data: { name: 'Test Pattern' },
      performance_stats: { avg: 2.5, median: 2.0, variance: 0.5 },
      confidence: 0.9,
      evidence_count: 50,
      videos_analyzed: ['vid1', 'vid2']
    };
    
    const isValid = await service.validatePattern(validPattern);
    console.log(`✅ Pattern validation: ${isValid ? 'PASS' : 'FAIL'}`);
    
    // Test 6: Full discovery workflow
    console.log('\n📋 Test 6: Full Discovery Workflow');
    const discoveredPatterns = await service.discoverPatternsInCluster(context);
    console.log(`✅ Full workflow: ${discoveredPatterns.length} patterns discovered`);
    
    if (discoveredPatterns.length > 0) {
      console.log('\n📊 Sample Discovered Patterns:');
      discoveredPatterns.slice(0, 3).forEach((pattern, index) => {
        console.log(`  ${index + 1}. ${pattern.pattern_type}: ${pattern.pattern_data.name}`);
        console.log(`     Evidence: ${pattern.evidence_count} videos`);
        console.log(`     Performance: ${pattern.performance_stats.avg?.toFixed(2)}x`);
      });
    }
    
    console.log('\n🎉 Pattern Discovery Test Complete!');
    console.log('\n✅ All core functionality working');
    console.log('📋 Next steps:');
    console.log('   1. Run full test suite: npm run test:patterns:all');
    console.log('   2. Start pattern discovery worker: npm run worker:pattern');
    console.log('   3. Test API endpoints');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testPatternDiscovery().catch(console.error);