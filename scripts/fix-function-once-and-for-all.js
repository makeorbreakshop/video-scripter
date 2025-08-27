#!/usr/bin/env node

import { Client } from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL not found in environment variables');
  process.exit(1);
}

async function fixFunctionOnceAndForAll() {
  const client = new Client({ connectionString });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    console.log('⚙️ Configuring session...');
    await client.query('SET statement_timeout = 0');
    
    console.log('🗑️ DROPPING ALL VERSIONS of get_random_video_ids...');
    await client.query(`
      DROP FUNCTION IF EXISTS get_random_video_ids(int, int, int, text, int);
      DROP FUNCTION IF EXISTS get_random_video_ids(int, int, int, text, int, text);
      DROP FUNCTION IF EXISTS get_random_video_ids(integer, integer, integer, text, integer);
      DROP FUNCTION IF EXISTS get_random_video_ids(integer, integer, integer, text, integer, text);
    `);
    
    console.log('✅ All old versions dropped');
    
    console.log('\n🚀 Creating ONE SINGLE FAST VERSION with category support...');
    
    // Create THE ONLY VERSION - with 6 parameters that the API expects
    await client.query(`
      CREATE OR REPLACE FUNCTION get_random_video_ids(
        p_outlier_score int DEFAULT 2,
        p_min_views int DEFAULT 1000,
        p_days_ago int DEFAULT 90,
        p_domain text DEFAULT NULL,
        p_sample_size int DEFAULT 500,
        p_category text DEFAULT NULL
      )
      RETURNS TABLE(video_id text)
      LANGUAGE sql AS
      $$
        -- SIMPLE, FAST, NO WRAP-AROUND
        SELECT v.id
        FROM videos v
        WHERE v.temporal_performance_score >= p_outlier_score
          AND v.temporal_performance_score <= 100
          AND v.view_count >= p_min_views
          AND v.published_at >= NOW() - (p_days_ago || ' days')::interval
          AND v.is_short = false
          AND v.is_institutional = false  -- Direct column check (FAST!)
          AND (p_domain IS NULL OR v.topic_domain = p_domain)
          AND (p_category IS NULL OR p_category = 'all' OR v.metadata->>'category_id' = p_category)
        ORDER BY random_sort  -- Simple indexed sort
        LIMIT p_sample_size * 2;  -- Get 2x for variety
      $$;
    `);
    
    console.log('✅ Created THE ONE TRUE FUNCTION with:');
    console.log('   - 6 parameters (includes category)');
    console.log('   - NO wrap-around logic');
    console.log('   - Direct is_institutional check');
    console.log('   - Simple ORDER BY random_sort');

    // Verify only one function exists
    const checkResult = await client.query(`
      SELECT COUNT(*) as count
      FROM pg_proc
      WHERE proname = 'get_random_video_ids'
        AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
    `);
    
    console.log(`\n✅ Verification: ${checkResult.rows[0].count} version(s) exist (should be 1)`);

    // Test the actual problematic case
    console.log('\n🧪 Testing YOUR EXACT TIMEOUT CASE (180 days, 1.5x)...');
    
    const startTime = Date.now();
    const result = await client.query(`
      SELECT COUNT(*) as count
      FROM get_random_video_ids(1, 10000, 180, NULL, 500, NULL);
    `);
    
    const duration = Date.now() - startTime;
    const status = duration < 1000 ? '✅' : duration < 3000 ? '⚠️' : '❌';
    console.log(`${status} Half year, 1.5x, 10K+ views: ${result.rows[0].count} videos in ${duration}ms`);
    
    if (duration > 3000) {
      console.log('\n⚠️ Still slow! Checking why...');
      const explainResult = await client.query(`
        EXPLAIN (ANALYZE, BUFFERS) 
        SELECT v.id
        FROM videos v
        WHERE v.temporal_performance_score >= 1
          AND v.temporal_performance_score <= 100
          AND v.view_count >= 10000
          AND v.published_at >= NOW() - INTERVAL '180 days'
          AND v.is_short = false
          AND v.is_institutional = false
        ORDER BY v.random_sort
        LIMIT 1000;
      `);
      console.log('Query plan:', explainResult.rows.map(r => r['QUERY PLAN']).join('\n'));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Connection closed');
    console.log('\n✨ NOW try your youtube-demo-v2 page - it should work!');
  }
}

// Run the script
fixFunctionOnceAndForAll();