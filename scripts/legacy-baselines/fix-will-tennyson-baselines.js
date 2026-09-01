import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function fixWillTennysonBaselines() {
  const client = await pool.connect();
  
  try {
    console.log('Starting Will Tennyson baseline fix...');
    
    // First, get all Will Tennyson videos that need fixing
    const checkResult = await client.query(`
      SELECT COUNT(*) as count
      FROM videos
      WHERE channel_id = 'UCB2wtYpfbCpYDc5TeTwuqFA'
        AND channel_baseline_at_publish = 1.0
        AND is_short = false
    `);
    
    console.log(`Found ${checkResult.rows[0].count} videos to fix`);
    
    // Process in batches of 50 to avoid timeouts
    const batchSize = 50;
    let offset = 0;
    let totalUpdated = 0;
    
    while (true) {
      console.log(`Processing batch starting at offset ${offset}...`);
      
      // First get the videos to update
      const videosToUpdate = await client.query(`
        SELECT id, published_at, view_count, channel_id
        FROM videos
        WHERE channel_id = 'UCB2wtYpfbCpYDc5TeTwuqFA'
          AND channel_baseline_at_publish = 1.0
          AND is_short = false
        ORDER BY published_at
        LIMIT $1 OFFSET $2
      `, [batchSize, offset]);
      
      if (videosToUpdate.rows.length === 0) {
        break;
      }
      
      // Process each video individually to avoid complex SQL
      const updatePromises = videosToUpdate.rows.map(async (video) => {
        // Calculate baseline for this video
        const baselineResult = await client.query(`
          SELECT AVG(view_count)::NUMERIC as baseline
          FROM (
            SELECT view_count
            FROM videos
            WHERE channel_id = $1
              AND published_at < $2
              AND published_at >= $2::timestamp - INTERVAL '30 days'
              AND is_short = false
              AND view_count > 0
            ORDER BY published_at DESC
            LIMIT 10
          ) recent_videos
        `, [video.channel_id, video.published_at]);
        
        const baseline = parseFloat(baselineResult.rows[0]?.baseline || 1.0);
        let temporalScore = video.view_count / baseline;
        
        // Cap temporal score to fit NUMERIC(8,3) - max is 99999.999
        if (temporalScore > 99999.999) {
          temporalScore = 99999.999;
        }
        
        // Update the video
        return client.query(`
          UPDATE videos
          SET 
            channel_baseline_at_publish = $1,
            temporal_performance_score = $2,
            updated_at = NOW()
          WHERE id = $3
          RETURNING id, title, channel_baseline_at_publish, temporal_performance_score
        `, [baseline, temporalScore, video.id]);
      });
      
      const results = await Promise.all(updatePromises);
      const updatedCount = results.length;
      totalUpdated += updatedCount;
      
      console.log(`Updated ${updatedCount} videos in this batch`);
      
      if (updatedCount > 0) {
        console.log('Sample updates:');
        results.slice(0, 3).forEach(result => {
          const row = result.rows[0];
          if (row) {
            console.log(`  - ${row.title.substring(0, 50)}... | Baseline: ${parseFloat(row.channel_baseline_at_publish).toFixed(0)} | Score: ${parseFloat(row.temporal_performance_score).toFixed(2)}`);
          }
        });
      }
      
      if (videosToUpdate.rows.length < batchSize) {
        break;
      }
      
      offset += batchSize;
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n✅ Successfully updated ${totalUpdated} videos`);
    
    // Show final statistics
    const statsResult = await client.query(`
      SELECT 
        COUNT(*) as total_videos,
        AVG(channel_baseline_at_publish) as avg_baseline,
        AVG(temporal_performance_score) as avg_score,
        MIN(temporal_performance_score) as min_score,
        MAX(temporal_performance_score) as max_score
      FROM videos
      WHERE channel_id = 'UCB2wtYpfbCpYDc5TeTwuqFA'
        AND is_short = false
        AND temporal_performance_score IS NOT NULL
    `);
    
    const stats = statsResult.rows[0];
    console.log('\nFinal Statistics for Will Tennyson:');
    console.log(`  Total videos: ${stats.total_videos}`);
    console.log(`  Average baseline: ${parseFloat(stats.avg_baseline).toLocaleString()}`);
    console.log(`  Average temporal score: ${parseFloat(stats.avg_score).toFixed(2)}`);
    console.log(`  Score range: ${parseFloat(stats.min_score).toFixed(2)} - ${parseFloat(stats.max_score).toFixed(2)}`);
    
  } catch (error) {
    console.error('Error updating baselines:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the fix
fixWillTennysonBaselines().catch(console.error);