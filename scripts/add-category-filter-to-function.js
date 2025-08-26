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

async function addCategoryFilterToFunction() {
  const client = new Client({ connectionString });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    console.log('⚙️ Configuring session...');
    await client.query('SET statement_timeout = 0');
    
    console.log('🔄 Updating function to support category filtering...');
    
    // Update function to include category parameter
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
          -- NEW: Category filter
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
            -- NEW: Category filter
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
            -- NEW: Category filter
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
              -- NEW: Category filter
              AND (p_category IS NULL OR p_category = 'all' OR v.metadata->>'category_id' = p_category)
              AND v.random_sort >= start_point
            ORDER BY v.random_sort
            LIMIT p_sample_size
          ) existing);
        END IF;
      END;
      $$;
    `);
    
    console.log('✅ Function updated with category filtering support!');

    // Test the function with different categories
    console.log('\n🧪 Testing category filtering...');
    
    // Test 1: Education category (27)
    console.log('\nTest 1: Education category (ID: 27)');
    const educationTest = await client.query(`
      SELECT COUNT(*) as count
      FROM get_random_video_ids(
        p_outlier_score => 2,
        p_min_views => 10000,
        p_days_ago => 30,
        p_sample_size => 50,
        p_category => '27'
      );
    `);
    console.log(`  ✅ Found ${educationTest.rows[0].count} Education videos`);
    
    // Test 2: Science & Technology (28)
    console.log('\nTest 2: Science & Technology category (ID: 28)');
    const techTest = await client.query(`
      SELECT COUNT(*) as count
      FROM get_random_video_ids(
        p_outlier_score => 2,
        p_min_views => 10000,
        p_days_ago => 30,
        p_sample_size => 50,
        p_category => '28'
      );
    `);
    console.log(`  ✅ Found ${techTest.rows[0].count} Science & Tech videos`);
    
    // Test 3: All categories (NULL)
    console.log('\nTest 3: All categories (NULL)');
    const allTest = await client.query(`
      SELECT COUNT(*) as count
      FROM get_random_video_ids(
        p_outlier_score => 2,
        p_min_views => 10000,
        p_days_ago => 30,
        p_sample_size => 50,
        p_category => NULL
      );
    `);
    console.log(`  ✅ Found ${allTest.rows[0].count} videos from all categories`);

    // Verify category filtering is working
    console.log('\n🔍 Verifying category filtering...');
    const verifyResult = await client.query(`
      SELECT v.metadata->>'category_id' as category_id, COUNT(*) as count
      FROM (
        SELECT * FROM get_random_video_ids(
          p_outlier_score => 2,
          p_min_views => 10000,
          p_days_ago => 30,
          p_sample_size => 50,
          p_category => '27'
        )
      ) ids
      JOIN videos v ON v.id = ids.video_id
      GROUP BY v.metadata->>'category_id';
    `);
    
    if (verifyResult.rows.length === 1 && verifyResult.rows[0].category_id === '27') {
      console.log('✅ Category filtering is working correctly!');
    } else {
      console.log('⚠️ Category filtering may have issues:');
      verifyResult.rows.forEach(row => {
        console.log(`  - Category ${row.category_id}: ${row.count} videos`);
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
addCategoryFilterToFunction();