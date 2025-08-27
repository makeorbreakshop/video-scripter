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

async function fixSlowCountFunction() {
  const client = new Client({ connectionString });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    console.log('⚙️ Configuring session...');
    await client.query('SET statement_timeout = 0');
    
    console.log('🔄 Fixing the slow count function...');
    
    // Fix the count function to use indexed fields
    await client.query(`
      CREATE OR REPLACE FUNCTION get_filtered_video_count(
        p_outlier_score NUMERIC DEFAULT 3,
        p_min_views INTEGER DEFAULT 100000,
        p_days_ago INTEGER DEFAULT 7,
        p_domain TEXT DEFAULT NULL
      )
      RETURNS INTEGER
      LANGUAGE plpgsql AS
      $$
      DECLARE
        result_count INTEGER;
      BEGIN
        SELECT COUNT(*)::INTEGER INTO result_count
        FROM videos v
        WHERE v.temporal_performance_score >= p_outlier_score
          AND v.view_count >= p_min_views
          AND v.published_at >= NOW() - INTERVAL '1 day' * p_days_ago
          AND v.is_short = false
          AND v.is_institutional = false  -- Use indexed field!
          AND (p_domain IS NULL OR v.topic_domain = p_domain);

        RETURN result_count;
      END;
      $$;
    `);
    
    console.log('✅ Fixed count function to use indexed fields!');

    // Test performance
    console.log('\n🧪 Testing count function performance...');
    
    const tests = [
      { days: 730, score: 2, views: 100, desc: '2 years, 2x, 100+ views (worst case)' },
      { days: 30, score: 3, views: 10000, desc: 'Month, 3x, 10K+ views' },
      { days: 7, score: 3, views: 100000, desc: 'Week, 3x, 100K+ views' }
    ];
    
    for (const test of tests) {
      const startTime = Date.now();
      const result = await client.query(`
        SELECT * FROM get_filtered_video_count(
          p_outlier_score := $1,
          p_min_views := $2,
          p_days_ago := $3,
          p_domain := NULL
        );
      `, [test.score, test.views, test.days]);
      
      const duration = Date.now() - startTime;
      const status = duration < 100 ? '✅' : duration < 500 ? '⚠️' : '❌';
      console.log(`${status} ${test.desc}: ${result.rows[0].get_filtered_video_count} videos in ${duration}ms`);
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
fixSlowCountFunction();