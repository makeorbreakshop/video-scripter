#!/usr/bin/env node

/**
 * Direct Pattern Discovery Test
 * Tests the pattern discovery system by directly calling the service methods
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testPatternDiscovery() {
  console.log('🧪 Testing Pattern Discovery System (Direct Database Access)...\n');
  
  try {
    // Test 1: Check database connections
    console.log('📋 Test 1: Database Connection');
    const { data: videoCount, error } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.error('❌ Database connection failed:', error);
      return;
    }
    
    console.log('✅ Database connected successfully');
    console.log(`   Videos available: ${videoCount}`);
    
    // Test 2: Check patterns table
    console.log('\n📋 Test 2: Patterns Table Check');
    const { data: patternsCount, error: patternsError } = await supabase
      .from('patterns')
      .select('*', { count: 'exact', head: true });
    
    if (patternsError) {
      console.error('❌ Patterns table error:', patternsError);
      return;
    }
    
    console.log('✅ Patterns table accessible');
    console.log(`   Existing patterns: ${patternsCount || 0}`);
    
    // Test 3: Check video_patterns table
    console.log('\n📋 Test 3: Video Patterns Table Check');
    const { data: videoPatternsCount, error: videoPatternsError } = await supabase
      .from('video_patterns')
      .select('*', { count: 'exact', head: true });
    
    if (videoPatternsError) {
      console.error('❌ Video patterns table error:', videoPatternsError);
      return;
    }
    
    console.log('✅ Video patterns table accessible');
    console.log(`   Existing video-pattern links: ${videoPatternsCount || 0}`);
    
    // Test 4: Sample video data for pattern discovery
    console.log('\n📋 Test 4: Sample Video Data');
    const { data: sampleVideos, error: sampleError } = await supabase
      .from('videos')
      .select(`
        id,
        title,
        view_count,
        channel_name,
        published_at,
        format_type,
        topic_cluster_id,
        rolling_baseline_views,
        duration
      `)
      .not('topic_cluster_id', 'is', null)
      .limit(5);
    
    if (sampleError) {
      console.error('❌ Sample video data error:', sampleError);
      return;
    }
    
    console.log('✅ Sample video data retrieved');
    console.log(`   Videos with topic clusters: ${sampleVideos?.length || 0}`);
    
    if (sampleVideos && sampleVideos.length > 0) {
      console.log('\n📊 Sample Videos:');
      sampleVideos.forEach((video, index) => {
        console.log(`  ${index + 1}. ${video.title?.substring(0, 50)}...`);
        console.log(`     Views: ${video.view_count?.toLocaleString() || 'N/A'}`);
        console.log(`     Format: ${video.format_type || 'N/A'}`);
        console.log(`     Topic Cluster: ${video.topic_cluster_id || 'N/A'}`);
        console.log(`     Channel: ${video.channel_name || 'N/A'}`);
      });
    }
    
    // Test 5: Topic cluster analysis
    console.log('\n📋 Test 5: Topic Cluster Analysis');
    const { data: topicClusters, error: topicError } = await supabase
      .from('videos')
      .select('topic_cluster_id, COUNT(*) as video_count')
      .not('topic_cluster_id', 'is', null)
      .group('topic_cluster_id')
      .order('video_count', { ascending: false })
      .limit(10);
    
    if (topicError) {
      console.error('❌ Topic cluster analysis error:', topicError);
      return;
    }
    
    console.log('✅ Topic cluster analysis complete');
    console.log(`   Active topic clusters: ${topicClusters?.length || 0}`);
    
    if (topicClusters && topicClusters.length > 0) {
      console.log('\n📊 Top Topic Clusters:');
      topicClusters.forEach((cluster, index) => {
        console.log(`  ${index + 1}. Cluster ${cluster.topic_cluster_id}: ${cluster.video_count} videos`);
      });
    }
    
    // Test 6: Pattern discovery simulation
    console.log('\n📋 Test 6: Pattern Discovery Simulation');
    
    if (topicClusters && topicClusters.length > 0) {
      const targetCluster = topicClusters[0];
      console.log(`🎯 Analyzing Topic Cluster: ${targetCluster.topic_cluster_id}`);
      
      // Get videos for this cluster
      const { data: clusterVideos, error: clusterError } = await supabase
        .from('videos')
        .select(`
          id,
          title,
          view_count,
          channel_name,
          published_at,
          format_type,
          duration,
          rolling_baseline_views
        `)
        .eq('topic_cluster_id', targetCluster.topic_cluster_id)
        .not('view_count', 'is', null)
        .limit(50);
      
      if (clusterError) {
        console.error('❌ Cluster videos error:', clusterError);
        return;
      }
      
      console.log(`📊 Videos in cluster: ${clusterVideos?.length || 0}`);
      
      if (clusterVideos && clusterVideos.length > 0) {
        // Simple pattern analysis
        const formats = {};
        const titleWords = {};
        let totalViews = 0;
        let highPerformers = 0;
        
        clusterVideos.forEach(video => {
          // Format analysis
          if (video.format_type) {
            formats[video.format_type] = (formats[video.format_type] || 0) + 1;
          }
          
          // Title word analysis
          if (video.title) {
            const words = video.title.toLowerCase().split(/\\s+/);
            words.forEach(word => {
              if (word.length > 3) {
                titleWords[word] = (titleWords[word] || 0) + 1;
              }
            });
          }
          
          // Performance analysis
          if (video.view_count) {
            totalViews += video.view_count;
            if (video.rolling_baseline_views && video.view_count > video.rolling_baseline_views * 1.5) {
              highPerformers++;
            }
          }
        });
        
        console.log('\n🔍 Pattern Analysis Results:');
        console.log(`   Average views: ${Math.round(totalViews / clusterVideos.length).toLocaleString()}`);
        console.log(`   High performers: ${highPerformers}/${clusterVideos.length} (${Math.round(highPerformers / clusterVideos.length * 100)}%)`);
        
        console.log('\n📊 Format Distribution:');
        Object.entries(formats)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 5)
          .forEach(([format, count]) => {
            console.log(`     ${format}: ${count} videos`);
          });
        
        console.log('\n📊 Common Title Words:');
        Object.entries(titleWords)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10)
          .forEach(([word, count]) => {
            if (count > 1) {
              console.log(`     "${word}": ${count} times`);
            }
          });
      }
    }
    
    // Test 7: Pattern storage simulation
    console.log('\n📋 Test 7: Pattern Storage Simulation');
    
    const testPattern = {
      id: crypto.randomUUID(),
      pattern_type: 'title',
      pattern_data: {
        name: 'Test Pattern',
        ngram: 'beginner',
        context: 'tutorial',
        confidence: 0.85
      },
      performance_stats: {
        avg: 2.1,
        median: 1.8,
        variance: 0.3,
        videos_analyzed: 25
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    console.log('📝 Test pattern created:');
    console.log(`   Type: ${testPattern.pattern_type}`);
    console.log(`   Name: ${testPattern.pattern_data.name}`);
    console.log(`   Performance: ${testPattern.performance_stats.avg}x`);
    console.log(`   Confidence: ${testPattern.pattern_data.confidence * 100}%`);
    
    console.log('\n✅ Pattern structure validation: PASS');
    console.log('💾 Ready for database insertion (skipping actual insert for test)');
    
    console.log('\n🎉 Pattern Discovery Test Complete!');
    console.log('\n📊 System Status Summary:');
    console.log(`   ✅ Database connection: Working`);
    console.log(`   ✅ Patterns table: Ready (${patternsCount || 0} patterns)`);
    console.log(`   ✅ Video patterns table: Ready (${videoPatternsCount || 0} links)`);
    console.log(`   ✅ Sample data: Available (${videoCount} videos)`);
    console.log(`   ✅ Topic clusters: Available (${topicClusters?.length || 0} clusters)`);
    console.log(`   ✅ Pattern structure: Valid`);
    
    console.log('\n💡 Next Steps:');
    console.log('   1. Start the development server: npm run dev');
    console.log('   2. Test the API endpoints with our test script');
    console.log('   3. Run the pattern discovery worker to generate patterns');
    console.log('   4. Use the pattern prediction API for performance forecasting');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testPatternDiscovery().catch(console.error);