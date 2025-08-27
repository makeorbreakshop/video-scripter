#!/usr/bin/env node
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Pool } = pg;

async function addRandomSort() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // Your direct connection
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🎲 Adding random_sort column to videos table...');
    console.log('📡 Using direct database connection (no timeouts!)');
    
    // Step 1: Add column if it doesn't exist
    try {
      await pool.query('ALTER TABLE videos ADD COLUMN random_sort float');
      console.log('✅ Column added successfully');
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('⚠️  Column already exists, continuing...');
      } else {
        throw err;
      }
    }
    
    // Step 2: Update ALL rows at once (direct connection can handle it)
    console.log('🚀 Updating all rows with random values (this will take 2-3 minutes)...');
    const startTime = Date.now();
    
    const result = await pool.query(`
      UPDATE videos 
      SET random_sort = random() 
      WHERE random_sort IS NULL
    `);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Updated ${result.rowCount.toLocaleString()} rows in ${duration} seconds!`);
    
    // Step 3: Create index
    console.log('📇 Creating index on random_sort...');
    await pool.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_random_sort ON videos(random_sort)');
    console.log('✅ Index created successfully!');
    
    // Step 4: Update the function
    console.log('🔧 Updating get_random_video_ids function...');
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
    console.log('✅ Function updated to use random_sort!');
    
    console.log('\n🎉 Done! Your API should now be blazing fast!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

addRandomSort().catch(console.error);