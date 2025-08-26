#!/usr/bin/env node

/**
 * Check current baseline calculation performance
 * Tests if the optimization is still in effect
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

    // Test the actual baseline calculation function performance
    console.log('🧪 Testing calculate_video_channel_baseline() performance...\n');
    
    // Get a sample of videos that need baselines
    const sampleResult = await client.query(`
      SELECT v.id, v.channel_id, v.published_at
      FROM videos v
      WHERE v.channel_baseline_at_publish = 1.0
        AND v.is_short = false
        AND v.view_count > 0
        AND EXISTS (
          SELECT 1 FROM videos v2 
          WHERE v2.channel_id = v.channel_id 
          AND v2.published_at < v.published_at
        )
      LIMIT 5
    `);
    
    if (sampleResult.rows.length === 0) {
      console.log('No videos needing baseline calculation found');
      return;
    }
    
    console.log(`Testing with ${sampleResult.rows.length} sample videos...\n`);
    
    for (const video of sampleResult.rows) {
      console.log(`Video ID: ${video.id}`);
      console.log(`Channel: ${video.channel_id}`);
      
      // Test the exact function call with EXPLAIN ANALYZE
      const explainResult = await client.query(`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT calculate_video_channel_baseline($1, $2) as baseline
      `, [video.channel_id, video.published_at]);
      
      const plan = explainResult.rows[0]['QUERY PLAN'][0];
      const planningTime = plan['Planning Time'];
      const executionTime = plan['Execution Time'];
      const totalTime = planningTime + executionTime;
      
      console.log(`  Planning Time: ${planningTime.toFixed(2)} ms`);
      console.log(`  Execution Time: ${executionTime.toFixed(2)} ms`);
      console.log(`  Total Time: ${totalTime.toFixed(2)} ms`);
      console.log(`  Theoretical Rate: ${Math.round(1000 / totalTime)} videos/second`);
      console.log('');
    }
    
    // Now test the actual fix function
    console.log('\n🧪 Testing fix_temporal_baselines_safe() with batch of 10...\n');
    
    const fixStartTime = Date.now();
    const fixResult = await client.query('SELECT fix_temporal_baselines_safe(10) as result');
    const fixTime = (Date.now() - fixStartTime) / 1000;
    
    const data = fixResult.rows[0]?.result;
    const videosFixed = data?.total_updated || 0;
    
    console.log(`Fixed ${videosFixed} videos in ${fixTime.toFixed(1)} seconds`);
    console.log(`Actual Rate: ${Math.round(videosFixed / fixTime)} videos/second`);
    
    if (videosFixed / fixTime < 50) {
      console.log('\n⚠️  Performance is still slow. Possible causes:');
      console.log('  1. Database is under heavy load from other queries');
      console.log('  2. Network latency between script and database');
      console.log('  3. The function is doing more work than expected');
      console.log('  4. Statistics may have become stale again');
      
      console.log('\n🔧 Running quick VACUUM ANALYZE on videos table...');
      const vacuumStart = Date.now();
      await client.query('VACUUM ANALYZE videos');
      const vacuumTime = (Date.now() - vacuumStart) / 1000;
      console.log(`✅ VACUUM ANALYZE completed in ${vacuumTime.toFixed(1)} seconds`);
      
      console.log('\n🔄 Testing again after VACUUM ANALYZE...');
      const retestStart = Date.now();
      const retestResult = await client.query('SELECT fix_temporal_baselines_safe(10) as result');
      const retestTime = (Date.now() - retestStart) / 1000;
      const retestData = retestResult.rows[0]?.result;
      const retestFixed = retestData?.total_updated || 0;
      
      console.log(`Fixed ${retestFixed} videos in ${retestTime.toFixed(1)} seconds`);
      console.log(`New Rate: ${Math.round(retestFixed / retestTime)} videos/second`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

// Run the check
checkPerformance().catch(console.error);