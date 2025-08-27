#!/usr/bin/env node
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Pool } = pg;

async function updateWithProgress() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  
  try {
    console.log('🚀 Random Sort Update with Progress\n');
    
    // Disable all timeouts
    await client.query('SET statement_timeout = 0');
    await client.query('SET lock_timeout = 0');
    await client.query('SET idle_in_transaction_session_timeout = 0');
    console.log('✅ Timeouts disabled\n');
    
    // Check status
    const status = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE random_sort IS NOT NULL) as done,
        COUNT(*) FILTER (WHERE random_sort IS NULL) as remaining,
        COUNT(*) as total
      FROM videos
    `);
    
    const { done, remaining, total } = status.rows[0];
    console.log(`📊 Current Status:`);
    console.log(`   Total videos: ${parseInt(total).toLocaleString()}`);
    console.log(`   Already done: ${parseInt(done).toLocaleString()}`);
    console.log(`   Need update: ${parseInt(remaining).toLocaleString()}\n`);
    
    if (remaining == 0) {
      console.log('✨ All rows already updated!');
    } else {
      // Update in chunks so we can show progress
      const chunkSize = 50000;
      let totalUpdated = 0;
      const startTime = Date.now();
      let iteration = 0;
      
      console.log(`⚡ Updating in ${chunkSize.toLocaleString()}-row chunks...\n`);
      
      while (totalUpdated < remaining) {
        iteration++;
        const chunkStart = Date.now();
        
        // Update next chunk
        const result = await client.query(`
          UPDATE videos 
          SET random_sort = random() 
          WHERE id IN (
            SELECT id FROM videos 
            WHERE random_sort IS NULL 
            LIMIT ${chunkSize}
          )
        `);
        
        if (result.rowCount === 0) break;
        
        totalUpdated += result.rowCount;
        
        // Calculate stats
        const chunkTime = ((Date.now() - chunkStart) / 1000).toFixed(1);
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = Math.round(totalUpdated / (parseFloat(totalTime) || 1));
        const percent = ((totalUpdated / remaining) * 100).toFixed(1);
        const eta = Math.round((remaining - totalUpdated) / rate);
        
        console.log(`Chunk ${iteration}: Updated ${result.rowCount.toLocaleString()} rows in ${chunkTime}s`);
        console.log(`Progress: ${totalUpdated.toLocaleString()}/${parseInt(remaining).toLocaleString()} (${percent}%)`);
        console.log(`Speed: ${rate.toLocaleString()} rows/sec | ETA: ${eta} seconds\n`);
      }
      
      const finalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      const finalRate = Math.round(totalUpdated / (parseFloat(finalTime) || 1));
      
      console.log(`✅ COMPLETE! Updated ${totalUpdated.toLocaleString()} rows in ${finalTime} seconds`);
      console.log(`⚡ Average speed: ${finalRate.toLocaleString()} rows/second\n`);
    }
    
    // Create index
    console.log('📇 Creating index (if needed)...');
    try {
      await client.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_random_sort 
        ON videos(random_sort)
      `);
      console.log('✅ Index ready!\n');
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('✅ Index already exists!\n');
      } else throw err;
    }
    
    // Update function
    console.log('🔧 Updating function...');
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
    
    console.log('🎉 ALL DONE! Your API should now be instant!');
    console.log('📊 Test it at: http://localhost:3000/youtube-demo-v2');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    
    if (error.message.includes('timeout')) {
      console.log('\n💡 Still timing out? Try running this directly in Supabase SQL Editor:');
      console.log('----------------------------------------');
      console.log('SET statement_timeout = 0;');
      console.log('UPDATE videos SET random_sort = random() WHERE random_sort IS NULL;');
      console.log('----------------------------------------');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

updateWithProgress().catch(console.error);