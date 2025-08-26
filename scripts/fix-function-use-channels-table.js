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

async function updateFunctionToUseChannelsTable() {
  const client = new Client({ connectionString });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    console.log('⚙️ Configuring session...');
    await client.query('SET statement_timeout = 0');
    
    console.log('🔄 Updating function to filter using channels table...');
    
    // Update function to check channels table for institutional flag
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
          -- Check institutional flag from channels table instead!
          AND v.channel_id NOT IN (
            SELECT channel_id FROM channels WHERE is_institutional = true
          )
          AND (p_domain IS NULL OR v.topic_domain = p_domain)
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
              AND v.random_sort >= start_point
            ORDER BY v.random_sort
            LIMIT p_sample_size
          ) existing);
        END IF;
      END;
      $$;
    `);
    
    console.log('✅ Function updated to use channels table for institutional filtering');

    // Test to make sure ABC News is filtered out
    console.log('\n🧪 Testing that institutional channels are filtered...');
    
    const result = await client.query(`
      SELECT v.channel_name, COUNT(*) as count
      FROM (
        SELECT * FROM get_random_video_ids(
          p_outlier_score => 2,
          p_min_views => 10000,
          p_days_ago => 30,
          p_sample_size => 100
        )
      ) ids
      JOIN videos v ON v.id = ids.video_id
      WHERE v.channel_name IN ('ABC News', 'PBS NewsHour', 'DW News', 'TODAY', 'Wrexham AFC')
      GROUP BY v.channel_name;
    `);
    
    if (result.rows.length === 0) {
      console.log('✅ No institutional channels found in results - filter working correctly!');
    } else {
      console.log('⚠️ Found institutional channels in results:');
      result.rows.forEach(row => {
        console.log(`  - ${row.channel_name}: ${row.count} videos`);
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
updateFunctionToUseChannelsTable();