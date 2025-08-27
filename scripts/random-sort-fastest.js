#!/usr/bin/env node
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Pool } = pg;

async function fastestUpdate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  
  try {
    console.log('🚀 FASTEST Random Sort Update\n');
    
    // Disable timeouts
    await client.query('SET statement_timeout = 0');
    console.log('✅ Timeout disabled\n');
    
    // Check what needs updating
    const status = await client.query(
      'SELECT COUNT(*) as remaining FROM videos WHERE random_sort IS NULL'
    );
    const remaining = parseInt(status.rows[0].remaining);
    
    console.log(`📊 Rows to update: ${remaining.toLocaleString()}\n`);
    
    if (remaining > 0) {
      console.log('⚡ Updating ALL rows in ONE query (no subqueries)...');
      console.log('   This should take 10-30 seconds...\n');
      
      const startTime = Date.now();
      
      // THE FAST WAY - Direct update, no subquery!
      const result = await client.query(`
        UPDATE videos 
        SET random_sort = random() 
        WHERE random_sort IS NULL
      `);
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = Math.round(result.rowCount / (parseFloat(duration) || 1));
      
      console.log(`✅ SUCCESS!`);
      console.log(`   Updated: ${result.rowCount.toLocaleString()} rows`);
      console.log(`   Time: ${duration} seconds`);
      console.log(`   Speed: ${rate.toLocaleString()} rows/second\n`);
    }
    
    // Create index and update function
    console.log('📇 Finalizing...');
    
    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_random_sort 
      ON videos(random_sort)
    `);
    
    await client.query(`
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
    
    console.log('✅ Index and function ready!\n');
    console.log('🎉 DONE! Test your API - should be instant now!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

fastestUpdate().catch(console.error);