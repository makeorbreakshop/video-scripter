#!/usr/bin/env node

/**
 * Deploy and test the fixed paginated function
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('🚀 Deploying and Testing Paginated Function');
console.log('='.repeat(50));

async function deployFunction() {
  console.log('\n📥 Deploying fixed paginated function...');
  
  try {
    // Read the SQL file
    const sqlContent = readFileSync('./sql/fix-get-videos-to-track-paginated.sql', 'utf8');
    
    // Execute the SQL
    const { error } = await supabase.rpc('query', { query: sqlContent });
    
    if (error) {
      console.error('❌ Error deploying function:', error);
      return false;
    }
    
    console.log('✅ Function deployed successfully');
    return true;
    
  } catch (error) {
    console.error('❌ Exception deploying function:', error);
    return false;
  }
}

async function testPaginatedFunction() {
  console.log('\n🧪 Testing paginated function...');
  
  try {
    // Test first batch
    console.log('🔍 Testing first batch (0-1000)...');
    const { data: batch1, error: error1 } = await supabase
      .rpc('get_videos_to_track_batch', { p_offset: 0, p_limit: 1000 });
    
    if (error1) {
      console.error('❌ Error in first batch:', error1);
      return false;
    }
    
    console.log(`✅ First batch: ${batch1?.length ?? 0} rows`);
    if (batch1 && batch1.length > 0) {
      console.log(`📊 Total available: ${batch1[0].total_count}`);
    }
    
    // Test second batch
    console.log('🔍 Testing second batch (1000-2000)...');
    const { data: batch2, error: error2 } = await supabase
      .rpc('get_videos_to_track_batch', { p_offset: 1000, p_limit: 1000 });
    
    if (error2) {
      console.error('❌ Error in second batch:', error2);
      return false;
    }
    
    console.log(`✅ Second batch: ${batch2?.length ?? 0} rows`);
    
    // Test a high offset batch
    console.log('🔍 Testing high offset batch (5000-6000)...');
    const { data: batch3, error: error3 } = await supabase
      .rpc('get_videos_to_track_batch', { p_offset: 5000, p_limit: 1000 });
    
    if (error3) {
      console.error('❌ Error in high offset batch:', error3);
      return false;
    }
    
    console.log(`✅ High offset batch: ${batch3?.length ?? 0} rows`);
    
    return true;
    
  } catch (error) {
    console.error('❌ Exception testing function:', error);
    return false;
  }
}

async function testRangeApproach() {
  console.log('\n🧪 Testing .range() approach as alternative...');
  
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Test range queries that simulate the RPC function logic
    console.log('🔍 Testing range queries (0-2999)...');
    const { data: rangeData, error: rangeError } = await supabase
      .from('view_tracking_priority')
      .select(`
        video_id,
        priority_tier,
        videos!inner(published_at)
      `)
      .not('videos.published_at', 'is', null)
      .or(`next_track_date.is.null,next_track_date.lte.${today}`)
      .order('priority_tier', { ascending: true })
      .range(0, 2999); // Try to get 3000 rows
    
    if (rangeError) {
      console.error('❌ Error with range query:', rangeError);
      return false;
    }
    
    console.log(`✅ Range query: ${rangeData?.length ?? 0} rows`);
    
    // Transform data to match expected format
    const transformedData = rangeData?.map(row => ({
      video_id: row.video_id,
      priority_tier: row.priority_tier,
      days_since_published: Math.floor(
        (Date.now() - new Date(row.videos.published_at).getTime()) / (1000 * 60 * 60 * 24)
      )
    })) ?? [];
    
    console.log(`✅ Transformed data: ${transformedData.length} rows ready for processing`);
    
    return transformedData;
    
  } catch (error) {
    console.error('❌ Exception with range approach:', error);
    return null;
  }
}

async function createRangeBasedSolution() {
  console.log('\n🔧 Creating range-based solution for ViewTrackingService...');
  
  // Create a helper function that uses .range() instead of RPC
  const solutionCode = `
// Add this method to ViewTrackingService class:

/**
 * Fetch videos to track using .range() method to bypass 1000 row RPC limit
 */
async fetchVideosToTrackRange(maxVideos = 100000) {
  const today = new Date().toISOString().split('T')[0];
  const batchSize = 1000;
  let allVideos = [];
  let offset = 0;
  
  console.log(\`Fetching videos to track using range method (max: \${maxVideos})...\`);
  
  while (allVideos.length < maxVideos) {
    const endRange = Math.min(offset + batchSize - 1, maxVideos - 1);
    
    const { data, error } = await this.supabase
      .from('view_tracking_priority')
      .select(\`
        video_id,
        priority_tier,
        videos!inner(published_at)
      \`)
      .not('videos.published_at', 'is', null)
      .or(\`next_track_date.is.null,next_track_date.lte.\${today}\`)
      .order('priority_tier', { ascending: true })
      .order('last_tracked', { ascending: true, nullsFirst: true })
      .order('videos(published_at)', { ascending: false })
      .range(offset, endRange);
    
    if (error) {
      console.error('Error fetching batch:', error);
      break;
    }
    
    if (!data || data.length === 0) {
      console.log('No more data available');
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
    
    console.log(\`Fetched batch: \${transformedBatch.length} videos (total: \${allVideos.length})\`);
    
    if (data.length < batchSize) {
      console.log('Final batch - no more data');
      break;
    }
    
    offset += batchSize;
  }
  
  return allVideos.slice(0, maxVideos);
}
`;

  console.log('💡 Range-based solution created:');
  console.log(solutionCode);
  
  return solutionCode;
}

async function main() {
  try {
    // Deploy the function
    const deployed = await deployFunction();
    
    if (deployed) {
      // Test the paginated function
      await testPaginatedFunction();
    }
    
    // Test range approach as alternative/backup
    const rangeData = await testRangeApproach();
    
    // Show the range-based solution
    await createRangeBasedSolution();
    
    console.log('\n✅ SUMMARY:');
    console.log('1. Paginated RPC function deployment:', deployed ? 'SUCCESS' : 'FAILED');
    console.log('2. Range query approach:', rangeData ? 'SUCCESS' : 'FAILED');
    console.log('3. Range approach can fetch', rangeData ? rangeData.length : 0, 'rows');
    
    if (rangeData && rangeData.length > 1000) {
      console.log('\n💡 RECOMMENDATION: Use .range() method');
      console.log('   - Proven to work with >1000 rows');
      console.log('   - Native Supabase method');
      console.log('   - No RPC function deployment needed');
    }
    
  } catch (error) {
    console.error('❌ Main function failed:', error);
  }
}

// Run the deployment and tests
main().catch(console.error);