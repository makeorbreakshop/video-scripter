#!/usr/bin/env node

/**
 * Test the range-based solution to verify it can fetch >1000 rows
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('🧪 Testing Range-Based Solution for View Tracking');
console.log('='.repeat(55));

/**
 * Implementation of the range-based solution
 */
async function fetchVideosToTrackRange(maxVideos = 15000) {
  const today = new Date().toISOString().split('T')[0];
  const batchSize = 1000;
  let allVideos = [];
  let offset = 0;
  
  console.log(`\n🔄 Fetching videos to track using range method (max: ${maxVideos})...`);
  
  while (allVideos.length < maxVideos) {
    const endRange = Math.min(offset + batchSize - 1, maxVideos - 1);
    
    const startTime = Date.now();
    const { data, error } = await supabase
      .from('view_tracking_priority')
      .select(`
        video_id,
        priority_tier,
        last_tracked,
        next_track_date,
        videos!inner(published_at)
      `)
      .not('videos.published_at', 'is', null)
      .or(`next_track_date.is.null,next_track_date.lte.${today}`)
      .order('priority_tier', { ascending: true })
      .order('last_tracked', { ascending: true, nullsFirst: true })
      .order('videos(published_at)', { ascending: false })
      .range(offset, endRange);
    
    const duration = Date.now() - startTime;
    
    if (error) {
      console.error(`❌ Error fetching batch at offset ${offset}:`, error);
      break;
    }
    
    if (!data || data.length === 0) {
      console.log(`🏁 No more data available at offset ${offset}`);
      break;
    }
    
    // Transform to expected format
    const transformedBatch = data.map(row => ({
      video_id: row.video_id,
      priority_tier: row.priority_tier,
      days_since_published: Math.floor(
        (Date.now() - new Date(row.videos.published_at).getTime()) / (1000 * 60 * 60 * 24)
      )
    }));
    
    allVideos = allVideos.concat(transformedBatch);
    
    console.log(`✅ Batch ${Math.floor(offset / batchSize) + 1}: ${transformedBatch.length} videos (${duration}ms) - Total: ${allVideos.length}`);
    
    if (data.length < batchSize) {
      console.log(`🏁 Final batch - got ${data.length} rows (less than ${batchSize})`);
      break;
    }
    
    offset += batchSize;
    
    // Small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  return allVideos.slice(0, maxVideos);
}

/**
 * Test tier distribution and priority ordering
 */
async function analyzeResults(videos) {
  console.log('\n📊 Analyzing Results');
  console.log('-'.repeat(30));
  
  // Count by tier
  const tierCounts = videos.reduce((acc, v) => {
    acc[v.priority_tier] = (acc[v.priority_tier] || 0) + 1;
    return acc;
  }, {});
  
  console.log('Videos by tier:');
  Object.entries(tierCounts)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .forEach(([tier, count]) => {
      console.log(`  Tier ${tier}: ${count} videos`);
    });
  
  // Check if properly ordered by tier
  let properlyOrdered = true;
  let lastTier = 0;
  for (const video of videos.slice(0, 100)) { // Check first 100
    if (video.priority_tier < lastTier) {
      properlyOrdered = false;
      break;
    }
    lastTier = video.priority_tier;
  }
  
  console.log(`\n✅ Proper tier ordering: ${properlyOrdered ? 'YES' : 'NO'}`);
  console.log(`📈 Total videos fetched: ${videos.length}`);
  console.log(`🎯 Target achieved: ${videos.length >= 14000 ? 'YES' : 'NO'} (needed >14,000)`);
  
  return {
    totalVideos: videos.length,
    tierCounts,
    properlyOrdered,
    targetAchieved: videos.length >= 14000
  };
}

/**
 * Compare with current ViewTrackingService approach
 */
async function compareWithCurrentApproach() {
  console.log('\n🔄 Comparing with current RPC approach...');
  
  try {
    // Test current RPC function with high limit
    const { data: rpcData, error: rpcError } = await supabase
      .rpc('get_videos_to_track', { p_daily_quota_limit: 15000 });
    
    if (rpcError) {
      console.error('❌ RPC function error:', rpcError);
      return { rpcRows: 0, rpcSuccess: false };
    }
    
    console.log(`✅ RPC function returned: ${rpcData?.length ?? 0} rows`);
    
    return {
      rpcRows: rpcData?.length ?? 0,
      rpcSuccess: true
    };
    
  } catch (error) {
    console.error('❌ Error testing RPC function:', error);
    return { rpcRows: 0, rpcSuccess: false };
  }
}

/**
 * Performance benchmark
 */
async function performanceBenchmark() {
  console.log('\n⏱️  Performance Benchmark');
  console.log('-'.repeat(30));
  
  const testSizes = [1000, 5000, 10000, 15000];
  const results = [];
  
  for (const size of testSizes) {
    console.log(`\n🧪 Testing ${size} videos...`);
    const startTime = Date.now();
    
    const videos = await fetchVideosToTrackRange(size);
    
    const duration = Date.now() - startTime;
    const videosPerSecond = Math.round((videos.length / duration) * 1000);
    
    console.log(`✅ Fetched ${videos.length} videos in ${duration}ms (${videosPerSecond} videos/sec)`);
    
    results.push({
      targetSize: size,
      actualSize: videos.length,
      duration,
      videosPerSecond
    });
    
    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return results;
}

/**
 * Main test runner
 */
async function main() {
  try {
    console.log('\n🎯 Target: Fetch 14,250+ videos (as needed for daily tracking)');
    
    // Main test - fetch all videos needed
    const videos = await fetchVideosToTrackRange(15000);
    
    // Analyze results
    const analysis = await analyzeResults(videos);
    
    // Compare with current approach
    const comparison = await compareWithCurrentApproach();
    
    // Performance benchmark
    const performance = await performanceBenchmark();
    
    // Final summary
    console.log('\n🏆 FINAL SUMMARY');
    console.log('='.repeat(50));
    
    console.log('\n📊 Results:');
    console.log(`  - Range method: ${analysis.totalVideos} videos`);
    console.log(`  - RPC method: ${comparison.rpcRows} videos`);
    console.log(`  - Range advantage: ${analysis.totalVideos - comparison.rpcRows} more videos`);
    
    console.log('\n✅ Success Criteria:');
    console.log(`  - Fetch >14,000 videos: ${analysis.targetAchieved ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  - Proper tier ordering: ${analysis.properlyOrdered ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  - Better than RPC: ${analysis.totalVideos > comparison.rpcRows ? '✅ PASS' : '❌ FAIL'}`);
    
    console.log('\n⚡ Performance:');
    performance.forEach(result => {
      console.log(`  - ${result.targetSize} videos: ${result.duration}ms (${result.videosPerSecond}/sec)`);
    });
    
    if (analysis.targetAchieved && analysis.properlyOrdered) {
      console.log('\n🎉 SUCCESS: Range-based solution works!');
      console.log('💡 RECOMMENDATION: Update ViewTrackingService to use range method');
    } else {
      console.log('\n⚠️  PARTIAL SUCCESS: Needs refinement');
    }
    
    // Save results
    const results = {
      timestamp: new Date().toISOString(),
      analysis,
      comparison,
      performance,
      success: analysis.targetAchieved && analysis.properlyOrdered
    };
    
    await import('fs').then(fs => 
      fs.promises.writeFile('range-solution-test-results.json', JSON.stringify(results, null, 2))
    );
    
    console.log('\n💾 Results saved to: range-solution-test-results.json');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the tests
main().catch(console.error);