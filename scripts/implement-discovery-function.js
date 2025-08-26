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

async function implementDiscoveryFunction() {
  const client = new Client({ connectionString });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    console.log('⚙️ Configuring session...');
    await client.query('SET statement_timeout = 0');
    
    console.log('🔄 Implementing discovery-optimized function...');
    
    // Approach: Use modulo of current time to cycle through content
    // This gives different results throughout the day without expensive randomization
    await client.query(`
      CREATE OR REPLACE FUNCTION get_random_video_ids(
        p_outlier_score int DEFAULT 2,
        p_min_views int DEFAULT 1000,
        p_days_ago int DEFAULT 90,
        p_domain text DEFAULT NULL,
        p_sample_size int DEFAULT 500
      )
      RETURNS TABLE(video_id text)
      LANGUAGE plpgsql AS
      $$
      DECLARE
        time_offset float;
        start_point float;
      BEGIN
        -- Use current minute to create a rotating offset
        -- Changes every minute, cycles through all content
        time_offset := (EXTRACT(EPOCH FROM NOW())::int / 60) % 1000 / 1000.0;
        
        -- Calculate starting point in the random_sort range
        start_point := time_offset;
        
        -- First, try to get results starting from our time-based offset
        RETURN QUERY
        SELECT v.id
        FROM videos v
        WHERE v.temporal_performance_score >= p_outlier_score
          AND v.temporal_performance_score <= 100
          AND v.view_count >= p_min_views
          AND v.published_at >= NOW() - (p_days_ago || ' days')::interval
          AND v.is_short = false
          AND v.is_institutional = false
          AND (p_domain IS NULL OR v.topic_domain = p_domain)
          AND v.random_sort >= start_point
        ORDER BY v.random_sort
        LIMIT p_sample_size;
        
        -- If we didn't get enough results (near end of range), wrap around
        IF (SELECT COUNT(*) FROM (
          SELECT v.id
          FROM videos v
          WHERE v.temporal_performance_score >= p_outlier_score
            AND v.temporal_performance_score <= 100
            AND v.view_count >= p_min_views
            AND v.published_at >= NOW() - (p_days_ago || ' days')::interval
            AND v.is_short = false
            AND v.is_institutional = false
            AND (p_domain IS NULL OR v.topic_domain = p_domain)
            AND v.random_sort >= start_point
          ORDER BY v.random_sort
          LIMIT p_sample_size
        ) t) < p_sample_size THEN
          
          -- Get remaining from start of range
          RETURN QUERY
          SELECT v.id
          FROM videos v
          WHERE v.temporal_performance_score >= p_outlier_score
            AND v.temporal_performance_score <= 100
            AND v.view_count >= p_min_views
            AND v.published_at >= NOW() - (p_days_ago || ' days')::interval
            AND v.is_short = false
            AND v.is_institutional = false
            AND (p_domain IS NULL OR v.topic_domain = p_domain)
            AND v.random_sort < start_point
          ORDER BY v.random_sort
          LIMIT p_sample_size - (SELECT COUNT(*) FROM (
            SELECT v.id
            FROM videos v
            WHERE v.temporal_performance_score >= p_outlier_score
              AND v.temporal_performance_score <= 100
              AND v.view_count >= p_min_views
              AND v.published_at >= NOW() - (p_days_ago || ' days')::interval
              AND v.is_short = false
              AND v.is_institutional = false
              AND (p_domain IS NULL OR v.topic_domain = p_domain)
              AND v.random_sort >= start_point
            ORDER BY v.random_sort
            LIMIT p_sample_size
          ) existing);
        END IF;
      END;
      $$;
    `);
    
    console.log('✅ Function updated with time-based rotation approach');

    // Test the function
    console.log('\n🧪 Testing discovery function performance...');
    
    // Test with increasingly broad filters
    const tests = [
      { days: 7, score: 3, views: 100000, desc: 'Week, 3x, 100K+ views' },
      { days: 30, score: 3, views: 10000, desc: 'Month, 3x, 10K+ views' },
      { days: 90, score: 2, views: 1000, desc: '3 months, 2x, 1K+ views' },
      { days: 730, score: 1.5, views: 100, desc: '2 years, 1.5x, 100+ views (worst case)' }
    ];
    
    for (const test of tests) {
      const startTime = Date.now();
      const result = await client.query(`
        SELECT COUNT(*) as count
        FROM get_random_video_ids(
          p_outlier_score => $1,
          p_min_views => $2,
          p_days_ago => $3,
          p_sample_size => 50
        );
      `, [test.score, test.views, test.days]);
      
      const duration = Date.now() - startTime;
      const status = duration < 1000 ? '✅' : duration < 3000 ? '⚠️' : '❌';
      console.log(`${status} ${test.desc}: ${result.rows[0].count} results in ${(duration / 1000).toFixed(2)}s`);
    }
    
    console.log('\n💡 Note: Results will change every minute as time progresses');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Connection closed');
  }
}

// Run the script
implementDiscoveryFunction();