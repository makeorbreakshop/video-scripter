#!/usr/bin/env node

/**
 * Check actual baseline calculation performance
 * Tests the real queries being used
 */

import { Client } from 'pg';
import { config } from 'dotenv';

config();

// Parse connection string from Supabase
function parseConnectionString(url) {
  const dbUrl = new URL(url);
  return {
    user: dbUrl.username,
    password: dbUrl.password,
    host: dbUrl.hostname,
    port: dbUrl.port || 5432,
    database: dbUrl.pathname.slice(1),
    ssl: { rejectUnauthorized: false }
  };
}

async function checkPerformance() {
  const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_URL;
  
  if (!DATABASE_URL) {
    console.error('❌ Missing DATABASE_URL or DIRECT_URL environment variable');
    return;
  }

  const client = new Client(parseConnectionString(DATABASE_URL));

  try {
    console.log('🔌 Connecting directly to PostgreSQL...');
    await client.connect();
    console.log('✅ Connected successfully!\n');

    // First check what functions exist
    console.log('📋 Checking available functions...');
    const funcResult = await client.query(`
      SELECT proname, pronargs 
      FROM pg_proc 
      WHERE proname LIKE '%baseline%' 
      ORDER BY proname
    `);
    
    console.log('Available baseline functions:');
    funcResult.rows.forEach(row => {
      console.log(`  - ${row.proname} (${row.pronargs} args)`);
    });
    console.log('');
    
    // Check the actual query pattern used for baseline calculation
    console.log('🧪 Testing the actual baseline calculation query pattern...\n');
    
    // Get a test channel with multiple videos
    const channelResult = await client.query(`
      SELECT channel_id, COUNT(*) as video_count
      FROM videos
      WHERE is_short = false
        AND published_at IS NOT NULL
        AND view_count > 0
      GROUP BY channel_id
      HAVING COUNT(*) > 10
      ORDER BY COUNT(*) DESC
      LIMIT 1
    `);
    
    if (channelResult.rows.length === 0) {
      console.log('No suitable channel found for testing');
      return;
    }
    
    const testChannel = channelResult.rows[0];
    console.log(`Test channel: ${testChannel.channel_id} (${testChannel.video_count} videos)\n`);
    
    // Test the query that would be used to calculate baseline
    console.log('Testing baseline calculation query (finding last 10 videos)...');
    
    const explainResult = await client.query(`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      WITH recent_videos AS (
        SELECT 
          v.id,
          v.view_count,
          v.published_at,
          GREATEST(1, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER) as video_age,
          pe.p50_views as current_p50,
          pe30.p50_views as day30_p50
        FROM videos v
        LEFT JOIN performance_envelopes pe 
          ON pe.day_since_published = LEAST(3650, GREATEST(1, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER))
        LEFT JOIN performance_envelopes pe30 
          ON pe30.day_since_published = 30
        WHERE v.channel_id = $1
          AND v.published_at < NOW() - INTERVAL '7 days'
          AND v.is_short = false
          AND v.view_count > 0
        ORDER BY v.published_at DESC
        LIMIT 10
      )
      SELECT 
        COUNT(*) as video_count,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY CASE 
            WHEN video_age <= 30 THEN view_count
            ELSE view_count * (day30_p50 / NULLIF(current_p50, 0))
          END
        ) as median_day30_performance
      FROM recent_videos
      WHERE current_p50 > 0 AND day30_p50 > 0
    `, [testChannel.channel_id]);
    
    const plan = explainResult.rows[0]['QUERY PLAN'][0];
    const planningTime = plan['Planning Time'];
    const executionTime = plan['Execution Time'];
    const totalTime = planningTime + executionTime;
    
    console.log(`  Planning Time: ${planningTime.toFixed(2)} ms`);
    console.log(`  Execution Time: ${executionTime.toFixed(2)} ms`);
    console.log(`  Total Time: ${totalTime.toFixed(2)} ms`);
    console.log(`  Theoretical Rate: ${Math.round(1000 / totalTime)} videos/second\n`);
    
    if (planningTime > 10) {
      console.log('⚠️  Planning time is high! Let\'s check index usage...\n');
      
      // Check which indexes are being used
      const indexResult = await client.query(`
        SELECT 
          schemaname,
          tablename,
          indexname,
          idx_scan,
          idx_tup_read,
          idx_tup_fetch,
          pg_size_pretty(pg_relation_size(indexrelid)) as size
        FROM pg_stat_user_indexes
        WHERE tablename = 'videos'
          AND indexname LIKE '%baseline%' OR indexname LIKE '%channel%'
        ORDER BY idx_scan DESC
      `);
      
      console.log('Index usage stats:');
      indexResult.rows.forEach(row => {
        console.log(`  ${row.indexname}: ${row.idx_scan} scans, ${row.size}`);
      });
      console.log('');
    }
    
    // Test the actual fix function with timing
    console.log('🧪 Testing fix_temporal_baselines_safe() performance...\n');
    
    // First check how many videos need fixing
    const countResult = await client.query(`
      SELECT COUNT(*) as need_fix
      FROM videos v
      WHERE v.channel_baseline_at_publish = 1.0
        AND v.is_short = false
        AND EXISTS (
          SELECT 1 FROM videos v2 
          WHERE v2.channel_id = v.channel_id 
          AND v2.published_at < v.published_at
        )
    `);
    
    console.log(`Videos needing baseline fix: ${countResult.rows[0].need_fix}\n`);
    
    // Test with different batch sizes
    const batchSizes = [1, 10, 50, 100];
    
    for (const batchSize of batchSizes) {
      console.log(`Testing batch size ${batchSize}...`);
      
      const startTime = Date.now();
      const result = await client.query('SELECT fix_temporal_baselines_safe($1) as result', [batchSize]);
      const elapsed = (Date.now() - startTime) / 1000;
      
      const data = result.rows[0]?.result;
      const videosFixed = data?.total_updated || 0;
      
      if (videosFixed > 0) {
        const rate = videosFixed / elapsed;
        console.log(`  Fixed ${videosFixed} videos in ${elapsed.toFixed(2)}s = ${Math.round(rate)} videos/sec`);
        
        // Calculate overhead
        const overhead = (elapsed * 1000 - videosFixed * totalTime) / videosFixed;
        console.log(`  Overhead per video: ${overhead.toFixed(2)} ms\n`);
      } else {
        console.log(`  No videos fixed (batch may be too small or no videos left)\n`);
      }
      
      // Don't test larger batches if small ones are already slow
      if (videosFixed > 0 && videosFixed / elapsed < 20) {
        console.log('⚠️  Performance is too slow, skipping larger batch sizes\n');
        break;
      }
    }
    
    // Final recommendations
    console.log('📊 Analysis:');
    if (totalTime > 100) {
      console.log('  ❌ Individual baseline calculations are too slow (>100ms each)');
      console.log('  This is the bottleneck - each video needs complex joins and median calculations');
    } else if (planningTime > 10) {
      console.log('  ⚠️  Query planning is slow - may need VACUUM ANALYZE');
    } else {
      console.log('  ✅ Individual queries are fast');
      console.log('  The bottleneck might be:');
      console.log('    - Network latency');
      console.log('    - Database connection overhead');
      console.log('    - The fix function doing extra work');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

// Run the check
checkPerformance().catch(console.error);