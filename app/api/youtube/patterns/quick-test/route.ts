/**
 * Quick Pattern Discovery Test API
 * Runs a fast test with small cluster and relaxed thresholds
 */

import { NextRequest, NextResponse } from 'next/server';
import { PatternDiscoveryService } from '@/lib/pattern-discovery-service';
import { getSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  const startTime = Date.now();
  
  try {
    console.log('🧪 Starting quick pattern discovery test...');
    
    const service = new PatternDiscoveryService();
    console.log(`✅ Service initialized with ${service.analyzers.length} analyzers`);
    
    // Get one small cluster for testing
    console.log('📊 Finding a small cluster...');
    const { data: clusters, error } = await supabase
      .from('videos')
      .select('topic_cluster_id')
      .not('topic_cluster_id', 'is', null)
      .limit(1000); // Get a sample to find cluster sizes
    
    if (error || !clusters || clusters.length === 0) {
      return NextResponse.json({
        error: 'No suitable clusters found',
        details: error
      }, { status: 404 });
    }
    
    // Count cluster sizes
    const clusterCounts = clusters.reduce((acc: Record<number, number>, video) => {
      acc[video.topic_cluster_id] = (acc[video.topic_cluster_id] || 0) + 1;
      return acc;
    }, {});
    
    // Find a cluster with 20-100 videos
    const suitableClusters = Object.entries(clusterCounts)
      .filter(([_, count]) => count >= 20 && count <= 100)
      .sort(([_, a], [__, b]) => a - b); // Smallest first
    
    if (suitableClusters.length === 0) {
      // Fallback to any cluster with at least 10 videos
      const fallbackClusters = Object.entries(clusterCounts)
        .filter(([_, count]) => count >= 10)
        .sort(([_, a], [__, b]) => a - b);
      
      if (fallbackClusters.length === 0) {
        return NextResponse.json({
          error: 'No clusters with sufficient videos found',
          clusterCounts: clusterCounts
        }, { status: 404 });
      }
      
      suitableClusters.push(fallbackClusters[0]);
    }
    
    const [testClusterId, videoCount] = suitableClusters[0];
    console.log(`🎯 Testing with cluster ${testClusterId} (${videoCount} videos)`);
    
    // Very relaxed context for quick testing
    const context = {
      topic_cluster_id: parseInt(testClusterId),
      min_performance: 1.2,  // Very low threshold
      min_confidence: 0.1,   // Very low confidence
      min_videos: 3          // Just need 3 videos
    };
    
    console.log('🔍 Running pattern discovery...');
    const discoveryStart = Date.now();
    
    const patterns = await service.discoverPatternsInCluster(context);
    
    const discoveryDuration = ((Date.now() - discoveryStart) / 1000).toFixed(1);
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log(`⏱️  Discovery completed in ${discoveryDuration} seconds`);
    console.log(`🎉 Found ${patterns.length} patterns`);
    
    // Store first pattern if any found
    let storageSuccess = false;
    if (patterns.length > 0) {
      try {
        console.log('💾 Testing pattern storage...');
        await service.storePatterns([patterns[0]]);
        storageSuccess = true;
        console.log('✅ Pattern stored successfully');
      } catch (storageError) {
        console.log('⚠️ Pattern storage failed:', storageError);
      }
    }
    
    // Prepare response data
    const response = {
      success: true,
      duration: `${totalDuration}s`,
      discoveryDuration: `${discoveryDuration}s`,
      patternsFound: patterns.length,
      clusterTested: {
        id: parseInt(testClusterId),
        videoCount: videoCount
      },
      context: context,
      storageSuccess,
      patterns: patterns.slice(0, 3).map(pattern => ({
        type: pattern.pattern_type,
        name: pattern.pattern_data.name,
        confidence: pattern.confidence,
        evidence: pattern.evidence_count,
        performance: pattern.performance_stats.avg
      })),
      analyzersRun: service.analyzers.map(a => a.constructor.name)
    };
    
    console.log('🎯 Quick test complete!');
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('❌ Quick test failed:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}