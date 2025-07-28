/**
 * Quick Pattern Discovery Test - Small Scale
 * Tests with just one cluster and relaxed thresholds
 */

import { PatternDiscoveryService } from './lib/pattern-discovery-service.ts';
import { supabase } from './lib/supabase.ts';

async function quickTest() {
  console.log('🧪 Quick Pattern Discovery Test\n');
  
  try {
    const service = new PatternDiscoveryService();
    console.log(`✅ Service initialized with ${service.analyzers.length} analyzers\n`);
    
    // Get one small cluster for testing
    console.log('📊 Finding a small cluster...');
    const { data: clusters, error } = await supabase
      .from('videos')
      .select('topic_cluster_id, COUNT(*) as count')
      .not('topic_cluster_id', 'is', null)
      .group('topic_cluster_id')
      .having('COUNT(*)', 'gte', 20)
      .having('COUNT(*)', 'lte', 100)
      .order('count', { ascending: true })
      .limit(1);
    
    if (error || !clusters || clusters.length === 0) {
      console.log('❌ No suitable clusters found');
      return;
    }
    
    const testCluster = clusters[0];
    console.log(`🎯 Testing with cluster ${testCluster.topic_cluster_id} (${testCluster.count} videos)`);
    
    // Very relaxed context for quick testing
    const context = {
      topic_cluster_id: testCluster.topic_cluster_id,
      min_performance: 1.2,  // Very low threshold
      min_confidence: 0.1,   // Very low confidence
      min_videos: 3          // Just need 3 videos
    };
    
    console.log('\n🔍 Running pattern discovery...');
    const startTime = Date.now();
    
    const patterns = await service.discoverPatternsInCluster(context);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n⏱️  Discovery completed in ${duration} seconds`);
    console.log(`🎉 Found ${patterns.length} patterns\n`);
    
    // Show pattern details
    if (patterns.length > 0) {
      console.log('📋 Pattern Details:');
      patterns.slice(0, 3).forEach((pattern, i) => {
        console.log(`\n${i + 1}. ${pattern.pattern_data.name}`);
        console.log(`   Type: ${pattern.pattern_type}`);
        console.log(`   Confidence: ${pattern.confidence.toFixed(2)}`);
        console.log(`   Evidence: ${pattern.evidence_count} videos`);
        console.log(`   Performance: ${pattern.performance_stats.avg.toFixed(2)}x`);
      });
      
      // Test pattern storage
      console.log('\n💾 Testing pattern storage...');
      const storageStart = Date.now();
      
      await service.storePatterns([patterns[0]]); // Store just the first one
      
      const storageTime = ((Date.now() - storageStart) / 1000).toFixed(1);
      console.log(`✅ Pattern stored in ${storageTime} seconds`);
      
      // Verify it was stored
      const { data: storedPatterns, error: fetchError } = await supabase
        .from('patterns')
        .select('*')
        .eq('pattern_type', patterns[0].pattern_type)
        .limit(1);
      
      if (fetchError) {
        console.log('❌ Error fetching stored pattern:', fetchError.message);
      } else if (storedPatterns && storedPatterns.length > 0) {
        console.log('✅ Pattern successfully stored in database');
      } else {
        console.log('⚠️  Pattern storage unclear - check database');
      }
    } else {
      console.log('⚠️  No patterns found. Try lowering thresholds or using a different cluster.');
    }
    
    console.log('\n🎯 Quick test complete!');
    console.log(`📊 Total time: ${((Date.now() - startTime) / 1000).toFixed(1)} seconds`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

// Run the test
quickTest().catch(console.error);