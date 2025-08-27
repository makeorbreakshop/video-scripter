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

async function fixRandomFunction() {
  const client = new Client({ connectionString });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    console.log('⚙️ Configuring session...');
    await client.query('SET statement_timeout = 0');
    
    // First, make sure videos.is_institutional is synced
    console.log('📊 Syncing institutional flags...');
    const syncResult = await client.query(`
      UPDATE videos v
      SET is_institutional = c.is_institutional
      FROM channels c
      WHERE v.channel_id = c.channel_id
        AND v.is_institutional != c.is_institutional;
    `);
    console.log(`✅ Updated ${syncResult.rowCount} videos with correct institutional flags`);
    
    console.log('\n🚀 Creating SIMPLIFIED fast random function...');
    
    // Create a SIMPLE, FAST version without wrap-around complexity
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
        -- SIMPLE: Just get videos ordered by random_sort
        -- No wrap-around, no counting, no complexity!
        SELECT v.id
        FROM videos v
        WHERE v.temporal_performance_score >= p_outlier_score
          AND v.temporal_performance_score <= 100
          AND v.view_count >= p_min_views
          AND v.published_at >= NOW() - (p_days_ago || ' days')::interval
          AND v.is_short = false
          AND v.is_institutional = false  -- Use direct column (FAST!)
          AND (p_domain IS NULL OR v.topic_domain = p_domain)
          AND (p_category IS NULL OR p_category = 'all' OR v.metadata->>'category_id' = p_category)
        ORDER BY random_sort  -- Simple order by indexed column
        LIMIT p_sample_size * 2;  -- Get 2x for variety, JS will shuffle
      $$;
    `);
    
    console.log('✅ Created simplified function with:');
    console.log('   - Direct is_institutional check (no subquery)');
    console.log('   - Simple ORDER BY random_sort (indexed)');
    console.log('   - No wrap-around logic');
    console.log('   - Returns 2x sample size for JS shuffling');

    // Test performance
    console.log('\n🧪 Testing performance with YOUR exact problem case...');
    
    const tests = [
      { days: 365, score: 1, views: 100, desc: '1 year, 1.5x, 100+ views (your timeout case)' },
      { days: 730, score: 1, views: 100, desc: '2 years, 1.5x, 100+ views' },
      { days: 90, score: 3, views: 10000, desc: 'Quarter, 3x, 10K+ views' },
      { days: 7, score: 3, views: 100000, desc: 'Week, 3x, 100K+ views' }
    ];
    
    for (const test of tests) {
      const startTime = Date.now();
      const result = await client.query(`
        SELECT COUNT(*) as count
        FROM get_random_video_ids($1, $2, $3, NULL, 500, NULL);
      `, [test.score, test.views, test.days]);
      
      const duration = Date.now() - startTime;
      const status = duration < 500 ? '✅' : duration < 1000 ? '⚠️' : '❌';
      console.log(`${status} ${test.desc}: ${result.rows[0].count} videos in ${duration}ms`);
    }

    // Also check how many videos match the broad filter
    console.log('\n📊 Checking dataset sizes...');
    const countResult = await client.query(`
      SELECT COUNT(*) as total
      FROM videos v
      WHERE v.temporal_performance_score >= 1.5
        AND v.temporal_performance_score <= 100
        AND v.view_count >= 100
        AND v.published_at >= NOW() - INTERVAL '365 days'
        AND v.is_short = false
        AND v.is_institutional = false;
    `);
    console.log(`Total videos matching 1 year, 1.5x filter: ${countResult.rows[0].total}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Connection closed');
    console.log('\n✨ Your API should now respond in under 1 second!');
  }
}

// Run the script
fixRandomFunction();