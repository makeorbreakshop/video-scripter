#!/usr/bin/env node

/**
 * Comprehensive View Tracking System Test Script
 * 
 * This script tests various aspects of the view tracking system to identify:
 * 1. The cause of the 1000 row limit
 * 2. Whether SQL functions exist and work correctly
 * 3. Alternative approaches for fetching >1000 rows
 * 4. Performance characteristics of different methods
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('🧪 View Tracking System Comprehensive Test Suite');
console.log('='.repeat(60));

/**
 * Test 1: Direct table query to establish baseline
 */
async function testDirectTableQuery() {
  console.log('\n📊 Test 1: Direct Table Query (Baseline)');
  console.log('-'.repeat(40));
  
  try {
    // First, get total count without limit
    const { count: totalCount, error: countError } = await supabase
      .from('view_tracking_priority')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.error('❌ Error getting total count:', countError);
      return;
    }
    
    console.log(`📈 Total videos in view_tracking_priority: ${totalCount}`);
    
    // Test fetching with no limit
    const startTime = Date.now();
    const { data: unlimitedData, error: unlimitedError } = await supabase
      .from('view_tracking_priority')
      .select('video_id, priority_tier')
      .limit(2000); // Try fetching 2000 rows
    
    const duration = Date.now() - startTime;
    
    if (unlimitedError) {
      console.error('❌ Error with 2000 row limit:', unlimitedError);
    } else {
      console.log(`✅ Fetched ${unlimitedData.length} rows in ${duration}ms`);
      console.log(`📊 Actual rows returned: ${unlimitedData.length} (requested: 2000)`);
    }
    
    // Test with very high limit
    const { data: highLimitData, error: highLimitError } = await supabase
      .from('view_tracking_priority')
      .select('video_id, priority_tier')
      .limit(50000);
    
    if (highLimitError) {
      console.error('❌ Error with 50000 row limit:', highLimitError);
    } else {
      console.log(`✅ High limit test: ${highLimitData.length} rows (requested: 50000)`);
    }
    
    return { totalCount, maxFetched: Math.max(unlimitedData?.length ?? 0, highLimitData?.length ?? 0) };
    
  } catch (error) {
    console.error('❌ Direct table query failed:', error);
    return null;
  }
}

/**
 * Test 2: Range-based queries (.range())
 */
async function testRangeQueries() {
  console.log('\n📊 Test 2: Range-based Queries');
  console.log('-'.repeat(40));
  
  try {
    const batchSize = 1000;
    const maxBatches = 20; // Test up to 20,000 rows
    let totalFetched = 0;
    let batchNum = 0;
    
    console.log(`🔄 Testing range queries with ${batchSize} rows per batch...`);
    
    while (batchNum < maxBatches) {
      const startRange = batchNum * batchSize;
      const endRange = startRange + batchSize - 1;
      
      const startTime = Date.now();
      const { data, error } = await supabase
        .from('view_tracking_priority')
        .select('video_id, priority_tier')
        .range(startRange, endRange)
        .order('priority_tier', { ascending: true });
      
      const duration = Date.now() - startTime;
      
      if (error) {
        console.error(`❌ Error in batch ${batchNum + 1} (range ${startRange}-${endRange}):`, error);
        break;
      }
      
      if (!data || data.length === 0) {
        console.log(`🏁 No more data at batch ${batchNum + 1} (range ${startRange}-${endRange})`);
        break;
      }
      
      totalFetched += data.length;
      console.log(`✅ Batch ${batchNum + 1}: ${data.length} rows (${duration}ms) - Total: ${totalFetched}`);
      
      if (data.length < batchSize) {
        console.log(`🏁 Final batch - got ${data.length} rows (less than ${batchSize})`);
        break;
      }
      
      batchNum++;
      
      // Add small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`📊 Range query result: Fetched ${totalFetched} total rows across ${batchNum + 1} batches`);
    return totalFetched;
    
  } catch (error) {
    console.error('❌ Range query test failed:', error);
    return 0;
  }
}

/**
 * Test 3: RPC Function Tests
 */
async function testRPCFunctions() {
  console.log('\n📊 Test 3: RPC Function Tests');
  console.log('-'.repeat(40));
  
  const results = {};
  
  // Test original get_videos_to_track function
  console.log('🔍 Testing get_videos_to_track function...');
  try {
    const { data: originalData, error: originalError } = await supabase
      .rpc('get_videos_to_track', { p_daily_quota_limit: 100 });
    
    if (originalError) {
      console.error('❌ get_videos_to_track error:', originalError);
      results.original = { error: originalError.message };
    } else {
      console.log(`✅ get_videos_to_track: ${originalData?.length ?? 0} rows`);
      results.original = { success: true, rows: originalData?.length ?? 0 };
    }
  } catch (error) {
    console.error('❌ get_videos_to_track exception:', error);
    results.original = { error: error.message };
  }
  
  // Test with larger limit
  console.log('🔍 Testing get_videos_to_track with 5000 limit...');
  try {
    const { data: largeData, error: largeError } = await supabase
      .rpc('get_videos_to_track', { p_daily_quota_limit: 5000 });
    
    if (largeError) {
      console.error('❌ get_videos_to_track (5000) error:', largeError);
      results.large = { error: largeError.message };
    } else {
      console.log(`✅ get_videos_to_track (5000): ${largeData?.length ?? 0} rows`);
      results.large = { success: true, rows: largeData?.length ?? 0 };
    }
  } catch (error) {
    console.error('❌ get_videos_to_track (5000) exception:', error);
    results.large = { error: error.message };
  }
  
  // Test paginated function
  console.log('🔍 Testing get_videos_to_track_batch function...');
  try {
    const { data: paginatedData, error: paginatedError } = await supabase
      .rpc('get_videos_to_track_batch', { p_offset: 0, p_limit: 1000 });
    
    if (paginatedError) {
      console.error('❌ get_videos_to_track_batch error:', paginatedError);
      results.paginated = { error: paginatedError.message };
    } else {
      console.log(`✅ get_videos_to_track_batch: ${paginatedData?.length ?? 0} rows`);
      if (paginatedData && paginatedData.length > 0) {
        console.log(`📊 Total count from function: ${paginatedData[0].total_count}`);
      }
      results.paginated = { 
        success: true, 
        rows: paginatedData?.length ?? 0,
        totalCount: paginatedData?.[0]?.total_count
      };
    }
  } catch (error) {
    console.error('❌ get_videos_to_track_batch exception:', error);
    results.paginated = { error: error.message };
  }
  
  return results;
}

/**
 * Test 4: Multi-batch paginated fetching
 */
async function testPaginatedFetching() {
  console.log('\n📊 Test 4: Multi-batch Paginated Fetching');
  console.log('-'.repeat(40));
  
  try {
    console.log('🔄 Testing paginated RPC function with multiple batches...');
    
    let totalFetched = 0;
    let batchNum = 0;
    let hasMore = true;
    const batchSize = 1000;
    const maxBatches = 20; // Limit to prevent infinite loops
    
    while (hasMore && batchNum < maxBatches) {
      const offset = batchNum * batchSize;
      
      const startTime = Date.now();
      const { data, error } = await supabase
        .rpc('get_videos_to_track_batch', { 
          p_offset: offset, 
          p_limit: batchSize 
        });
      
      const duration = Date.now() - startTime;
      
      if (error) {
        console.error(`❌ Batch ${batchNum + 1} error:`, error);
        if (error.message.includes('function') && error.message.includes('does not exist')) {
          console.log('⚠️  Paginated function does not exist - this is the likely cause of the 1000 row limit');
        }
        break;
      }
      
      if (!data || data.length === 0) {
        console.log(`🏁 No more data at batch ${batchNum + 1}`);
        hasMore = false;
        break;
      }
      
      totalFetched += data.length;
      console.log(`✅ Batch ${batchNum + 1}: ${data.length} rows (${duration}ms) - Total: ${totalFetched}`);
      
      if (batchNum === 0 && data.length > 0) {
        console.log(`📊 Total available from function: ${data[0].total_count}`);
      }
      
      if (data.length < batchSize) {
        console.log(`🏁 Final batch - got ${data.length} rows (less than ${batchSize})`);
        hasMore = false;
      }
      
      batchNum++;
      
      // Small delay to avoid overwhelming server
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`📊 Paginated fetching result: ${totalFetched} total rows across ${batchNum} batches`);
    return totalFetched;
    
  } catch (error) {
    console.error('❌ Paginated fetching test failed:', error);
    return 0;
  }
}

/**
 * Test 5: Alternative approaches - Join queries
 */
async function testJoinQueries() {
  console.log('\n📊 Test 5: Alternative Join Query Approaches');
  console.log('-'.repeat(40));
  
  try {
    console.log('🔍 Testing direct join query (simulating RPC function logic)...');
    
    const today = new Date().toISOString().split('T')[0];
    
    // First test with small limit
    const { data: smallData, error: smallError } = await supabase
      .from('view_tracking_priority')
      .select(`
        video_id,
        priority_tier,
        videos!inner(id, published_at)
      `)
      .not('videos.published_at', 'is', null)
      .or(`next_track_date.is.null,next_track_date.lte.${today}`)
      .order('priority_tier', { ascending: true })
      .limit(100);
    
    if (smallError) {
      console.error('❌ Small join query error:', smallError);
    } else {
      console.log(`✅ Small join query: ${smallData?.length ?? 0} rows`);
    }
    
    // Test with larger limit
    const { data: largeData, error: largeError } = await supabase
      .from('view_tracking_priority')
      .select(`
        video_id,
        priority_tier,
        videos!inner(id, published_at)
      `)
      .not('videos.published_at', 'is', null)
      .or(`next_track_date.is.null,next_track_date.lte.${today}`)
      .order('priority_tier', { ascending: true })
      .limit(5000);
    
    if (largeError) {
      console.error('❌ Large join query error:', largeError);
    } else {
      console.log(`✅ Large join query: ${largeData?.length ?? 0} rows`);
    }
    
    return {
      small: smallData?.length ?? 0,
      large: largeData?.length ?? 0
    };
    
  } catch (error) {
    console.error('❌ Join query test failed:', error);
    return { small: 0, large: 0 };
  }
}

/**
 * Test 6: Check if SQL functions exist in database
 */
async function checkFunctionExistence() {
  console.log('\n📊 Test 6: Database Function Existence Check');
  console.log('-'.repeat(40));
  
  try {
    // Check what functions exist
    const { data: functions, error } = await supabase
      .from('pg_proc')
      .select('proname, pronargs')
      .like('proname', '%get_videos_to_track%');
    
    if (error) {
      console.error('❌ Error checking functions:', error);
    } else {
      console.log('🔍 Found functions containing "get_videos_to_track":');
      if (functions && functions.length > 0) {
        functions.forEach(func => {
          console.log(`  - ${func.proname} (${func.pronargs} args)`);
        });
      } else {
        console.log('  (No functions found)');
      }
    }
    
    return functions;
    
  } catch (error) {
    console.error('❌ Function existence check failed:', error);
    return null;
  }
}

/**
 * Test 7: ViewTrackingService class methods
 */
async function testViewTrackingServiceMethods() {
  console.log('\n📊 Test 7: ViewTrackingService Class Methods');
  console.log('-'.repeat(40));
  
  try {
    // Import the ViewTrackingService
    const { ViewTrackingService } = await import('./lib/view-tracking-service.ts');
    
    console.log('🔍 Testing ViewTrackingService.getTrackingStats()...');
    const service = new ViewTrackingService();
    const stats = await service.getTrackingStats();
    
    if (stats) {
      console.log('✅ ViewTrackingService stats:', stats);
    } else {
      console.log('❌ ViewTrackingService stats returned null');
    }
    
    return stats;
    
  } catch (error) {
    console.error('❌ ViewTrackingService test failed:', error);
    return null;
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  const results = {
    timestamp: new Date().toISOString(),
    tests: {}
  };
  
  try {
    // Run all tests
    results.tests.directTable = await testDirectTableQuery();
    results.tests.rangeQueries = await testRangeQueries();
    results.tests.rpcFunctions = await testRPCFunctions();
    results.tests.paginatedFetching = await testPaginatedFetching();
    results.tests.joinQueries = await testJoinQueries();
    results.tests.functionExistence = await checkFunctionExistence();
    results.tests.serviceClass = await testViewTrackingServiceMethods();
    
    // Summary analysis
    console.log('\n🔍 ANALYSIS SUMMARY');
    console.log('='.repeat(60));
    
    console.log('\n📊 Row Limit Analysis:');
    const directMax = results.tests.directTable?.maxFetched ?? 0;
    const rangeMax = results.tests.rangeQueries ?? 0;
    
    console.log(`  - Direct table query max: ${directMax} rows`);
    console.log(`  - Range query total: ${rangeMax} rows`);
    
    if (rangeMax > directMax) {
      console.log('✅ Range queries can fetch more rows than direct queries');
      console.log('💡 SOLUTION: Use .range() method to paginate beyond 1000 rows');
    } else if (directMax >= 2000) {
      console.log('✅ Direct queries can fetch >1000 rows');
      console.log('💡 The 1000 row limit may not be a hard Supabase limit');
    } else {
      console.log('⚠️  Both methods seem limited to ~1000 rows');
    }
    
    console.log('\n📊 RPC Function Analysis:');
    if (results.tests.rpcFunctions.paginated?.error) {
      console.log('❌ Paginated RPC function does not exist or has errors');
      console.log('💡 CAUSE: The get_videos_to_track_batch function is not deployed');
    } else {
      console.log('✅ Paginated RPC function exists and works');
    }
    
    if (results.tests.rpcFunctions.original?.success) {
      const originalRows = results.tests.rpcFunctions.original.rows;
      const largeRows = results.tests.rpcFunctions.large?.rows ?? 0;
      console.log(`  - Original function (100 limit): ${originalRows} rows`);
      console.log(`  - Original function (5000 limit): ${largeRows} rows`);
      
      if (largeRows <= 1000 && originalRows < largeRows) {
        console.log('⚠️  RPC function seems capped at ~1000 rows regardless of limit parameter');
        console.log('💡 CAUSE: Likely Supabase RPC default row limit');
      }
    }
    
    console.log('\n💡 RECOMMENDED SOLUTIONS:');
    
    if (rangeMax > 1000) {
      console.log('1. ✅ Use .range() method for pagination (BEST)');
      console.log('   - Fetch in batches using .range(start, end)');
      console.log('   - Can handle unlimited rows');
      console.log('   - Native Supabase method');
    }
    
    if (results.tests.rpcFunctions.paginated?.success) {
      console.log('2. ✅ Use paginated RPC function');
      console.log('   - Call get_videos_to_track_batch with offset/limit');
      console.log('   - Handles complex logic in database');
    } else {
      console.log('2. ⚠️  Deploy paginated RPC function');
      console.log('   - Run the SQL script: sql/fix-get-videos-to-track-paginated.sql');
      console.log('   - Then use get_videos_to_track_batch');
    }
    
    if (directMax > 1000) {
      console.log('3. ✅ Increase direct query limits');
      console.log('   - Use higher .limit() values in direct queries');
      console.log('   - May work for simpler queries');
    }
    
    // Save results to file
    const fs = await import('fs');
    await fs.promises.writeFile(
      'view-tracking-test-results.json', 
      JSON.stringify(results, null, 2)
    );
    console.log('\n💾 Test results saved to: view-tracking-test-results.json');
    
  } catch (error) {
    console.error('❌ Test suite failed:', error);
  }
}

// Run the tests
runAllTests().catch(console.error);