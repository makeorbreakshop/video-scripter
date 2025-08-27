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

async function optimizeWithChannelsTable() {
  const client = new Client({ connectionString });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    console.log('⚙️ Configuring session...');
    await client.query('SET statement_timeout = 0');
    
    console.log('🔄 Updating function to use channels table with EXISTS (fastest approach)...');
    
    // Update function to use EXISTS which is faster than NOT IN
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
      LANGUAGE plpgsql AS
      $$
      DECLARE
        time_offset float;
        start_point float;
      BEGIN
        -- Use current minute to create a rotating offset
        time_offset := (EXTRACT(EPOCH FROM NOW())::int / 60) % 1000 / 1000.0;
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
          -- Use EXISTS for better performance with channels table
          AND NOT EXISTS (
            SELECT 1 FROM channels c 
            WHERE c.channel_id = v.channel_id 
            AND c.is_institutional = true
          )
          AND (p_domain IS NULL OR v.topic_domain = p_domain)
          AND (p_category IS NULL OR p_category = 'all' OR v.metadata->>'category_id' = p_category)
          AND v.random_sort >= start_point
        ORDER BY v.random_sort
        LIMIT p_sample_size;
        
        -- Wrap-around logic (if needed)
        IF (SELECT COUNT(*) FROM (
          SELECT v.id
          FROM videos v
          WHERE v.temporal_performance_score >= p_outlier_score
            AND v.temporal_performance_score <= 100
            AND v.view_count >= p_min_views
            AND v.published_at >= NOW() - (p_days_ago || ' days')::interval
            AND v.is_short = false
            AND NOT EXISTS (
              SELECT 1 FROM channels c 
              WHERE c.channel_id = v.channel_id 
              AND c.is_institutional = true
            )
            AND (p_domain IS NULL OR v.topic_domain = p_domain)
            AND (p_category IS NULL OR p_category = 'all' OR v.metadata->>'category_id' = p_category)
            AND v.random_sort >= start_point
          ORDER BY v.random_sort
          LIMIT p_sample_size
        ) t) < p_sample_size THEN
          
          RETURN QUERY
          SELECT v.id
          FROM videos v
          WHERE v.temporal_performance_score >= p_outlier_score
            AND v.temporal_performance_score <= 100
            AND v.view_count >= p_min_views
            AND v.published_at >= NOW() - (p_days_ago || ' days')::interval
            AND v.is_short = false
            AND NOT EXISTS (
              SELECT 1 FROM channels c 
              WHERE c.channel_id = v.channel_id 
              AND c.is_institutional = true
            )
            AND (p_domain IS NULL OR v.topic_domain = p_domain)
            AND (p_category IS NULL OR p_category = 'all' OR v.metadata->>'category_id' = p_category)
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
              AND NOT EXISTS (
                SELECT 1 FROM channels c 
                WHERE c.channel_id = v.channel_id 
                AND c.is_institutional = true
              )
              AND (p_domain IS NULL OR v.topic_domain = p_domain)
              AND (p_category IS NULL OR p_category = 'all' OR v.metadata->>'category_id' = p_category)
              AND v.random_sort >= start_point
            ORDER BY v.random_sort
            LIMIT p_sample_size
          ) existing);
        END IF;
      END;
      $$;
    `);
    
    console.log('✅ Function updated to use channels table with EXISTS!');

    // Test performance
    console.log('\n🧪 Testing performance with EXISTS approach...');
    
    const tests = [
      { days: 730, score: 1, views: 100, desc: '2 years, 1.5x, 100+ views (worst case)' },
      { days: 30, score: 3, views: 10000, desc: 'Month, 3x, 10K+ views' },
      { days: 7, score: 3, views: 100000, desc: 'Week, 3x, 100K+ views' }
    ];
    
    for (const test of tests) {
      const startTime = Date.now();
      const result = await client.query(`
        SELECT COUNT(*) as count
        FROM get_random_video_ids(
          p_outlier_score := $1,
          p_min_views := $2,
          p_days_ago := $3,
          p_sample_size := 50
        );
      `, [test.score, test.views, test.days]);
      
      const duration = Date.now() - startTime;
      const status = duration < 1000 ? '✅' : duration < 3000 ? '⚠️' : '❌';
      console.log(`${status} ${test.desc}: ${result.rows[0].count} results in ${(duration / 1000).toFixed(2)}s`);
    }
    
    // Verify it's actually filtering institutional channels
    console.log('\n🔍 Verifying institutional filtering...');
    const verifyResult = await client.query(`
      SELECT v.channel_name, c.is_institutional
      FROM (
        SELECT * FROM get_random_video_ids(
          p_outlier_score := 2,
          p_min_views := 10000,
          p_days_ago := 30,
          p_sample_size := 100
        )
      ) ids
      JOIN videos v ON v.id = ids.video_id
      JOIN channels c ON c.channel_id = v.channel_id
      WHERE v.channel_name IN ('CBS News', 'Democracy Now!', 'USA TODAY', 'The Wall Street Journal')
      LIMIT 5;
    `);
    
    if (verifyResult.rows.length === 0) {
      console.log('✅ Institutional channels are properly filtered!');
    } else {
      console.log('❌ Found institutional channels that should be filtered:');
      verifyResult.rows.forEach(row => {
        console.log(`  - ${row.channel_name} (institutional: ${row.is_institutional})`);
      });
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
optimizeWithChannelsTable();