#!/usr/bin/env node
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Pool } = pg;

async function finalFix() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  
  try {
    console.log('🚀 Random Sort Final Fix\n');
    
    // CRITICAL: Set timeout for THIS SESSION ONLY
    await client.query('SET statement_timeout = 0');
    await client.query('SET lock_timeout = 0');
    await client.query('SET idle_in_transaction_session_timeout = 0');
    console.log('✅ Disabled all timeouts for this session\n');
    
    // Check how many need updating
    const status = await client.query(
      'SELECT COUNT(*) as remaining FROM videos WHERE random_sort IS NULL'
    );
    const remaining = parseInt(status.rows[0].remaining);
    
    if (remaining === 0) {
      console.log('✨ All rows already have random_sort!');
    } else {
      console.log(`📊 Updating ${remaining.toLocaleString()} rows...`);
      const startTime = Date.now();
      
      // Do it all at once - no timeout!
      const result = await client.query(
        'UPDATE videos SET random_sort = random() WHERE random_sort IS NULL'
      );
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = Math.round(result.rowCount / (duration || 1));
      
      console.log(`✅ Updated ${result.rowCount.toLocaleString()} rows in ${duration} seconds`);
      console.log(`⚡ Speed: ${rate.toLocaleString()} rows/second\n`);
    }
    
    // Create index
    console.log('Creating index (if needed)...');
    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_random_sort 
      ON videos(random_sort)
    `);
    console.log('✅ Index ready!\n');
    
    // Update function
    console.log('Updating function...');
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
    console.log('✅ Function updated!\n');
    
    console.log('🎉 SUCCESS! Test your API now - should be instant!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\nFull error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

finalFix().catch(console.error);