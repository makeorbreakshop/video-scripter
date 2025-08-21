/**
 * Test-driven debugging for idea-radar endpoint
 * Run with: node test-idea-radar.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testRPCFunction() {
  console.log('🧪 Testing RPC function performance...\n');
  
  const testCases = [
    { name: 'Small dataset', minScore: 5, minViews: 1000000, days: 30 },
    { name: 'Medium dataset', minScore: 3, minViews: 100000, days: 90 },
    { name: 'Large dataset (current failing)', minScore: 3, minViews: 10000, days: 730 },
  ];
  
  for (const test of testCases) {
    console.log(`\n📊 Test: ${test.name}`);
    console.log(`   Parameters: score>${test.minScore}, views>${test.minViews}, days=${test.days}`);
    
    const startTime = Date.now();
    
    try {
      // First, test the COUNT query directly
      const countStart = Date.now();
      const { data: countData, error: countError } = await supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .gte('temporal_performance_score', test.minScore)
        .lte('temporal_performance_score', 100)
        .gte('published_at', new Date(Date.now() - test.days * 24 * 60 * 60 * 1000).toISOString())
        .gte('view_count', test.minViews)
        .eq('is_short', false);
      
      const countTime = Date.now() - countStart;
      
      if (countError) {
        console.log(`   ❌ Count query failed: ${countError.message}`);
      } else {
        console.log(`   ✅ Count query: ${countData} rows in ${countTime}ms`);
      }
      
      // Now test the RPC function
      const rpcStart = Date.now();
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_random_outlier_videos_with_data', {
        seed_value: 0.5,
        min_score: test.minScore,
        days_back: test.days,
        min_views: test.minViews,
        domain_filter: null,
        page_limit: 20,
        page_offset: 0
      });
      
      const rpcTime = Date.now() - rpcStart;
      
      if (rpcError) {
        console.log(`   ❌ RPC function failed: ${rpcError.message} (${rpcTime}ms)`);
      } else {
        const videoCount = rpcData?.videos?.length || 0;
        const totalCount = rpcData?.total || 0;
        console.log(`   ✅ RPC function: ${videoCount} videos returned, ${totalCount} total in ${rpcTime}ms`);
      }
      
    } catch (error) {
      console.log(`   ❌ Unexpected error: ${error.message}`);
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`   ⏱️  Total test time: ${totalTime}ms`);
  }
  
  // Test the problematic part specifically
  console.log('\n\n🔍 Analyzing the slow part of the RPC function...');
  
  // The issue is likely the ORDER BY random() with large datasets
  const testQuery = `
    -- Direct SQL to understand the bottleneck
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT v.*
    FROM videos v
    LEFT JOIN channels c ON v.channel_id = c.channel_id
    WHERE
      v.temporal_performance_score >= 3
      AND v.temporal_performance_score <= 100
      AND v.published_at >= NOW() - INTERVAL '730 days'
      AND v.view_count >= 10000
      AND v.is_short = false
      AND (c.is_institutional = false OR c.is_institutional IS NULL)
    ORDER BY random()
    LIMIT 20;
  `;
  
  console.log('\n📝 The problem:');
  console.log('   The RPC function does ORDER BY random() on the FULL filtered dataset');
  console.log('   With 37k+ rows, this requires sorting ALL rows before taking 20');
  console.log('   The LEFT JOIN adds overhead for each row during the sort');
  
  console.log('\n💡 Suggested improvements:');
  console.log('   1. Use TABLESAMPLE for approximate randomness (much faster)');
  console.log('   2. Pre-filter with a random threshold instead of ORDER BY random()');
  console.log('   3. Remove the JOIN from the main query, filter institutional after');
  console.log('   4. Use a materialized view for pre-filtered non-institutional videos');
}

// Run the tests
testRPCFunction().then(() => {
  console.log('\n✅ Testing complete');
  process.exit(0);
}).catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});