#!/usr/bin/env node
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Pool } = pg;

async function addRandomSort() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 0,  // Disable timeout
    idle_in_transaction_session_timeout: 0  // Disable idle timeout
  });

  try {
    console.log('🎲 Updating random_sort column...');
    
    // Check current status
    const statusResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE random_sort IS NOT NULL) as completed,
        COUNT(*) FILTER (WHERE random_sort IS NULL) as remaining
      FROM videos
    `);
    
    const { completed, remaining } = statusResult.rows[0];
    console.log(`📊 Status: ${parseInt(completed).toLocaleString()} done, ${parseInt(remaining).toLocaleString()} remaining`);
    
    if (remaining == 0) {
      console.log('✨ All rows already updated!');
    } else {
      // Update in batches of 10K
      const batchSize = 10000;
      let totalUpdated = 0;
      const startTime = Date.now();
      
      while (totalUpdated < remaining) {
        const result = await pool.query(`
          UPDATE videos 
          SET random_sort = random() 
          WHERE id IN (
            SELECT id FROM videos 
            WHERE random_sort IS NULL 
            LIMIT ${batchSize}
          )
        `);
        
        totalUpdated += result.rowCount;
        const progress = ((totalUpdated / remaining) * 100).toFixed(1);
        const rate = Math.round((totalUpdated / ((Date.now() - startTime) / 1000)));
        
        console.log(`⚡ Updated ${totalUpdated.toLocaleString()}/${remaining} (${progress}%) - ${rate}/sec`);
        
        if (result.rowCount === 0) break;
      }
      
      console.log(`✅ Updated ${totalUpdated.toLocaleString()} rows!`);
    }
    
    // Create index if not exists
    console.log('📇 Creating index...');
    await pool.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_random_sort ON videos(random_sort)');
    console.log('✅ Index ready!');
    
    // Update function
    console.log('🔧 Updating function...');
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
    console.log('✅ Function updated!');
    
    console.log('\n🎉 Done! Test your API now!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

addRandomSort().catch(console.error);