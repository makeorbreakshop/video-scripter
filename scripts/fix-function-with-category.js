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

async function fixFunctionWithCategory() {
  const client = new Client({ connectionString });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    console.log('⚙️ Configuring session...');
    await client.query('SET statement_timeout = 0');
    
    console.log('🔄 Updating function with BOTH category filter AND performance optimization...');
    
    // Update function to include BOTH optimizations
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
          -- Check institutional flag from channels table
          AND v.channel_id NOT IN (
            SELECT channel_id FROM channels WHERE is_institutional = true
          )
          AND (p_domain IS NULL OR v.topic_domain = p_domain)
          -- Category filter
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
            AND v.channel_id NOT IN (
              SELECT channel_id FROM channels WHERE is_institutional = true
            )
            AND (p_domain IS NULL OR v.topic_domain = p_domain)
            -- Category filter
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
            AND v.channel_id NOT IN (
              SELECT channel_id FROM channels WHERE is_institutional = true
            )
            AND (p_domain IS NULL OR v.topic_domain = p_domain)
            -- Category filter
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
              AND v.channel_id NOT IN (
                SELECT channel_id FROM channels WHERE is_institutional = true
              )
              AND (p_domain IS NULL OR v.topic_domain = p_domain)
              -- Category filter
              AND (p_category IS NULL OR p_category = 'all' OR v.metadata->>'category_id' = p_category)
              AND v.random_sort >= start_point
            ORDER BY v.random_sort
            LIMIT p_sample_size
          ) existing);
        END IF;
      END;
      $$;
    `);
    
    console.log('✅ Function updated with BOTH category filtering AND performance optimization!');

    // Test performance with broad filters
    console.log('\n🧪 Testing performance with broad filters...');
    
    const startTime = Date.now();
    const result = await client.query(`
      SELECT COUNT(*) as count
      FROM get_random_video_ids(
        p_outlier_score => 1,
        p_min_views => 100,
        p_days_ago => 730,
        p_sample_size => 50,
        p_category => NULL
      );
    `);
    const duration = Date.now() - startTime;
    
    console.log(`✅ Fetched ${result.rows[0].count} results in ${(duration / 1000).toFixed(2)}s`);
    
    if (duration > 2000) {
      console.log('⚠️ WARNING: Still slow! Duration was', duration, 'ms');
    } else {
      console.log('✅ Performance is good!');
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
fixFunctionWithCategory();