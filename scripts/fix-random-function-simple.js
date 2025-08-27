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
    
    // Drop the old complex versions
    console.log('🗑️ Dropping old complex function versions...');
    await client.query(`
      DROP FUNCTION IF EXISTS get_random_video_ids(int, int, int, text, int);
      DROP FUNCTION IF EXISTS get_random_video_ids(int, int, int, text, int, text);
    `);
    
    console.log('✨ Creating simplified fast random function...');
    
    // Create a SIMPLE, FAST version
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
        -- Simple, single query, no loops, no wrap-around logic
        SELECT v.id
        FROM videos v
        WHERE v.temporal_performance_score >= p_outlier_score
          AND v.temporal_performance_score <= 100
          AND v.view_count >= p_min_views
          AND v.published_at >= NOW() - (p_days_ago || ' days')::interval
          AND v.is_short = false
          AND v.is_institutional = false
          AND (p_domain IS NULL OR v.topic_domain = p_domain)
          AND (p_category IS NULL OR p_category = 'all' OR v.metadata->>'category_id' = p_category)
        ORDER BY random_sort -- Use the indexed column
        LIMIT p_sample_size * 2; -- Get 2x to ensure variety after JS shuffle
      $$;
    `);
    
    console.log('✅ Created simplified function!');

    // Test performance
    console.log('\n🧪 Testing performance...');
    
    const tests = [
      { days: 730, score: 1.5, views: 100, desc: '2 years, 1.5x, 100+ views (worst case)' },
      { days: 90, score: 3, views: 10000, desc: 'Quarter, 3x, 10K+ views' },
      { days: 30, score: 3, views: 10000, desc: 'Month, 3x, 10K+ views' },
      { days: 7, score: 3, views: 100000, desc: 'Week, 3x, 100K+ views' }
    ];
    
    for (const test of tests) {
      const startTime = Date.now();
      const result = await client.query(`
        SELECT COUNT(*) as count
        FROM get_random_video_ids(
          p_outlier_score => $1,
          p_min_views => $2,
          p_days_ago => $3,
          p_sample_size => 500
        );
      `, [test.score, test.views, test.days]);
      
      const duration = Date.now() - startTime;
      const status = duration < 500 ? '✅' : duration < 1000 ? '⚠️' : '❌';
      console.log(`${status} ${test.desc}: ${result.rows[0].count} results in ${duration}ms`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Connection closed');
  }
}

// Run the script
fixRandomFunction();