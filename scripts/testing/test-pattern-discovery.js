/**
 * Test Pattern Discovery System
 * Script to test the pattern discovery pipeline
 */

import { PatternDiscoveryService } from '../lib/pattern-discovery-service.js';
import { supabase } from '../lib/supabase.js';
import dotenv from 'dotenv';

dotenv.config();

async function testPatternDiscovery() {
  console.log('🧪 Testing Pattern Discovery System...\n');

  try {
    // Initialize service
    const discoveryService = new PatternDiscoveryService();
    
    // Test 1: Check database connection
    console.log('📋 Test 1: Database Connection');
    const { data: videosCount, error } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.error('❌ Database connection failed:', error);
      return;
    }
    
    console.log(`✅ Database connected. Videos available: ${videosCount}`);
    
    // Test 2: Check for existing patterns
    console.log('\n📋 Test 2: Existing Patterns');
    const { data: existingPatterns, error: patternsError } = await supabase
      .from('patterns')
      .select('*', { count: 'exact', head: true });
    
    if (patternsError) {
      console.error('❌ Pattern table error:', patternsError);
      return;
    }
    
    console.log(`✅ Existing patterns: ${existingPatterns || 0}`);
    
    // Test 3: Get sample topic clusters
    console.log('\n📋 Test 3: Topic Clusters');
    const { data: topicClusters, error: topicError } = await supabase
      .from('videos')
      .select('topic_cluster')
      .not('topic_cluster', 'is', null)
      .limit(10);
    
    if (topicError) {
      console.error('❌ Topic cluster error:', topicError);
      return;
    }
    
    const uniqueClusters = [...new Set(topicClusters?.map(t => t.topic_cluster) || [])];
    console.log(`✅ Topic clusters found: ${uniqueClusters.length}`);
    console.log(`   Sample clusters: ${uniqueClusters.slice(0, 5).join(', ')}`);
    
    // Test 4: Run pattern discovery on a small sample
    console.log('\n📋 Test 4: Pattern Discovery (Small Sample)');
    
    const testContext = {
      topic_cluster: uniqueClusters[0], // Use first cluster
      min_performance: 1.5, // Lower threshold for testing
      min_confidence: 0.5,  // Lower threshold for testing
      min_videos: 10        // Lower threshold for testing
    };
    
    console.log('🔍 Testing with context:', testContext);
    
    const discoveredPatterns = await discoveryService.discoverPatternsInCluster(testContext);
    console.log(`✅ Patterns discovered: ${discoveredPatterns.length}`);
    
    // Display sample patterns
    if (discoveredPatterns.length > 0) {
      console.log('\n📊 Sample Patterns:');
      discoveredPatterns.slice(0, 3).forEach((pattern, index) => {
        console.log(`\n  ${index + 1}. ${pattern.pattern_type.toUpperCase()}: ${pattern.pattern_data.name}`);
        console.log(`     Evidence: ${pattern.evidence_count} videos`);
        console.log(`     Confidence: ${(pattern.confidence * 100).toFixed(1)}%`);
        console.log(`     Avg Performance: ${pattern.performance_stats.avg?.toFixed(2)}x`);
        
        if (pattern.pattern_data.examples) {
          console.log(`     Examples: ${pattern.pattern_data.examples.slice(0, 2).join(', ')}`);
        }
      });
    }
    
    // Test 5: Store patterns
    console.log('\n📋 Test 5: Pattern Storage');
    if (discoveredPatterns.length > 0) {
      console.log('💾 Storing patterns in database...');
      await discoveryService.storePatterns(discoveredPatterns);
      console.log('✅ Patterns stored successfully');
      
      // Verify storage
      const { data: newPatternCount, error: countError } = await supabase
        .from('patterns')
        .select('*', { count: 'exact', head: true });
      
      if (!countError) {
        console.log(`✅ Total patterns in database: ${newPatternCount}`);
      }
    } else {
      console.log('⚠️ No patterns to store');
    }
    
    // Test 6: Test API endpoints
    console.log('\n📋 Test 6: API Endpoints');
    
    // Test pattern list endpoint
    console.log('🔗 Testing pattern list endpoint...');
    const listResponse = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/api/youtube/patterns/list?limit=5`);
    
    if (listResponse.ok) {
      const listData = await listResponse.json();
      console.log(`✅ Pattern list API working. Found ${listData.patterns?.length || 0} patterns`);
    } else {
      console.log('❌ Pattern list API failed');
    }
    
    // Test pattern prediction endpoint
    console.log('🔗 Testing pattern prediction endpoint...');
    const predictionResponse = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/api/youtube/patterns/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'How to Build a Bookshelf for Beginners',
        format: 'tutorial',
        topic_cluster: uniqueClusters[0]
      })
    });
    
    if (predictionResponse.ok) {
      const predictionData = await predictionResponse.json();
      console.log(`✅ Pattern prediction API working. Predicted performance: ${predictionData.predicted_performance?.toFixed(2)}x`);
    } else {
      console.log('❌ Pattern prediction API failed');
    }
    
    console.log('\n🎉 Pattern Discovery System Test Complete!');
    console.log('\nNext steps:');
    console.log('1. Run pattern discovery worker: npm run worker:pattern');
    console.log('2. Check pattern analysis page for new insights');
    console.log('3. Monitor worker logs for ongoing discovery');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testPatternDiscovery().catch(console.error);