#!/usr/bin/env node
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Pool } = pg;

async function addRandomFast() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🚀 FAST random_sort update\n');
    
    // Step 1: Check if column exists
    const colCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'videos' AND column_name = 'random_sort'
    `);
    
    if (colCheck.rows.length === 0) {
      console.log('Adding column...');
      await pool.query('ALTER TABLE videos ADD COLUMN random_sort float');
    }
    
    // Step 2: The FAST way - use a CTE to generate all updates at once
    console.log('🎯 Generating random values for all rows in ONE query...');
    const startTime = Date.now();
    
    // This is the key - generate all random values in a single pass using the ID
    await pool.query(`
      UPDATE videos v
      SET random_sort = r.rand_val
      FROM (
        SELECT id, random() as rand_val
        FROM videos
        WHERE random_sort IS NULL
      ) r
      WHERE v.id = r.id
    `);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Updated all rows in ${duration} seconds!\n`);
    
    // Step 3: Create index
    console.log('Creating index...');
    try {
      await pool.query('CREATE INDEX CONCURRENTLY idx_videos_random_sort ON videos(random_sort)');
      console.log('✅ Index created!\n');
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('Index already exists\n');
      }
    }
    
    // Step 4: Replace the function
    console.log('Updating function to use random_sort...');
    await pool.query(`
      CREATE OR REPLACE FUNCTION get_random_video_ids(
        p_outlier_score int DEFAULT 2,
        p_min_views int DEFAULT 1000,
        p_days_ago int DEFAULT 90,
        p_domain text DEFAULT NULL,
        p_sample_size int DEFAULT 500
      )
      RETURNS TABLE(video_id text)
      LANGUAGE sql AS
      $$
        SELECT v.id
        FROM videos v
        WHERE v.temporal_performance_score >= p_outlier_score
          AND v.temporal_performance_score <= 100
          AND v.view_count >= p_min_views
          AND v.published_at >= NOW() - (p_days_ago || ' days')::interval
          AND v.is_short = false
          AND v.is_institutional = false
          AND (p_domain IS NULL OR v.topic_domain = p_domain)
          AND v.random_sort >= random()
        ORDER BY v.random_sort
        LIMIT p_sample_size;
      $$;
    `);
    
    console.log('✅ Function updated!\n');
    console.log('🎉 DONE! Your API should now be instant!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    // If it still times out, here's the nuclear option
    console.log('\n💡 If this timed out, run this SQL directly in Supabase:');
    console.log('----------------------------------------');
    console.log(`UPDATE videos SET random_sort = random() WHERE random_sort IS NULL;`);
    console.log('----------------------------------------');
    console.log('Then run this script again to create the index and function.\n');
  } finally {
    await pool.end();
  }
}

addRandomFast().catch(console.error);