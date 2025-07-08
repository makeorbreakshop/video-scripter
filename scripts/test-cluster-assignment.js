#!/usr/bin/env node

/**
 * Test script to verify cluster assignment is working correctly
 * This script checks a few videos to see if they have clusters assigned
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testClusterAssignment() {
  console.log('🧪 Testing Topic Cluster Assignment');
  console.log('=' * 50);
  
  try {
    // Get a sample of videos with clusters
    const { data: videosWithClusters, error: clustersError } = await supabase
      .from('videos')
      .select('id, title, channel_name, topic_cluster')
      .not('topic_cluster', 'is', null)
      .limit(10);
    
    if (clustersError) {
      throw new Error(`Database error: ${clustersError.message}`);
    }
    
    console.log(`\n📊 Found ${videosWithClusters.length} videos with clusters assigned:`);
    videosWithClusters.forEach(video => {
      console.log(`   Cluster ${video.topic_cluster}: "${video.title}" (${video.channel_name})`);
    });
    
    // Get cluster distribution
    const { data: clusterStats, error: statsError } = await supabase
      .from('videos')
      .select('topic_cluster')
      .not('topic_cluster', 'is', null);
    
    if (statsError) {
      throw new Error(`Stats error: ${statsError.message}`);
    }
    
    // Count videos per cluster
    const clusterCounts = {};
    clusterStats.forEach(video => {
      clusterCounts[video.topic_cluster] = (clusterCounts[video.topic_cluster] || 0) + 1;
    });
    
    const totalWithClusters = clusterStats.length;
    const uniqueClusters = Object.keys(clusterCounts).length;
    
    console.log(`\n📈 Cluster Statistics:`);
    console.log(`   Total videos with clusters: ${totalWithClusters}`);
    console.log(`   Unique clusters: ${uniqueClusters}`);
    
    // Show top 10 clusters
    const topClusters = Object.entries(clusterCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10);
    
    console.log(`\n🔥 Top 10 Clusters:`);
    topClusters.forEach(([cluster, count]) => {
      console.log(`   Cluster ${cluster}: ${count} videos`);
    });
    
    // Check for any invalid clusters (NaN, null, etc.)
    const { data: invalidClusters, error: invalidError } = await supabase
      .from('videos')
      .select('id, title, topic_cluster')
      .or('topic_cluster.is.null')
      .limit(5);
    
    if (invalidError) {
      throw new Error(`Invalid clusters error: ${invalidError.message}`);
    }
    
    console.log(`\n❓ Sample videos without clusters: ${invalidClusters.length}`);
    invalidClusters.forEach(video => {
      console.log(`   No cluster: "${video.title}" (cluster: ${video.topic_cluster})`);
    });
    
    // Test cluster-based queries
    if (topClusters.length > 0) {
      const testCluster = topClusters[0][0];
      console.log(`\n🔍 Testing cluster-based query for cluster ${testCluster}:`);
      
      const { data: clusterVideos, error: queryError } = await supabase
        .from('videos')
        .select('title, performance_ratio, view_count')
        .eq('topic_cluster', testCluster)
        .order('performance_ratio', { ascending: false })
        .limit(3);
      
      if (queryError) {
        throw new Error(`Query error: ${queryError.message}`);
      }
      
      clusterVideos.forEach(video => {
        console.log(`   "${video.title}" (${video.performance_ratio}x performance, ${video.view_count} views)`);
      });
    }
    
    console.log('\n✅ Cluster assignment test complete!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testClusterAssignment();
}