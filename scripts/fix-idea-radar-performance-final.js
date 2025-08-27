const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixIdeaRadarPerformance() {
  console.log('🔧 FIXING IDEA RADAR PERFORMANCE - THE REAL FIX');
  console.log('================================================');
  console.log('Problem: is_institutional filter was missing from index!');
  console.log('This caused PostgreSQL to scan thousands of extra rows\n');

  try {
    // Step 1: Drop old indexes
    console.log('1. Dropping old incomplete indexes...');
    await supabase.rpc('query', {
      query: `DROP INDEX IF EXISTS idx_videos_outlier_query`
    });
    await supabase.rpc('query', {
      query: `DROP INDEX IF EXISTS idx_videos_temporal_performance`
    });
    console.log('   ✅ Old indexes dropped\n');

    // Step 2: Create the CORRECT index
    console.log('2. Creating optimized index WITH is_institutional filter...');
    console.log('   This will take ~30 seconds on 660K rows...');
    
    const startTime = Date.now();
    const { error } = await supabase.rpc('query', {
      query: `
        CREATE INDEX CONCURRENTLY idx_videos_idea_radar_final ON videos(
          temporal_performance_score DESC,
          published_at DESC,
          view_count DESC
        ) WHERE 
          is_short = false 
          AND is_institutional = false 
          AND temporal_performance_score >= 1
          AND temporal_performance_score <= 100
      `
    });

    if (error) {
      console.error('❌ Error creating index:', error);
      throw error;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ✅ Index created in ${elapsed} seconds\n`);

    // Step 3: Test the performance
    console.log('3. Testing query performance...');
    console.log('   Filter: 2 years, score >= 3, views >= 10000');
    
    const testStart = Date.now();
    const { data, error: testError } = await supabase.rpc('get_random_video_ids', {
      p_outlier_score: 3,
      p_min_views: 10000,
      p_days_ago: 730,
      p_domain: null,
      p_sample_size: 1000,
      p_category: null
    });

    if (testError) {
      console.error('❌ Test query failed:', testError);
    } else {
      const testTime = Date.now() - testStart;
      console.log(`   ✅ Query returned ${data?.length || 0} IDs in ${testTime}ms`);
      
      if (testTime > 2000) {
        console.log(`   ⚠️  Still slower than expected. May need VACUUM ANALYZE`);
      } else {
        console.log(`   🎉 PERFORMANCE FIXED!`);
      }
    }

    console.log('\n✅ COMPLETE!');
    console.log('The index now properly filters is_institutional=false');
    console.log('This should reduce query time from 8+ seconds to <500ms');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

fixIdeaRadarPerformance();