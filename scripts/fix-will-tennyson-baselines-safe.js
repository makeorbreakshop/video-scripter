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
    console.log('Starting Will Tennyson baseline fix with proper calculations...\n');
    
    // First, let's understand the data
    const statsResult = await client.query(`
      SELECT 
        COUNT(*) as total_videos,
        MIN(published_at) as first_video,
        MAX(published_at) as last_video,
        AVG(view_count) as avg_views,
        MIN(view_count) as min_views,
        MAX(view_count) as max_views
      FROM videos
      WHERE channel_id = 'UCB2wtYpfbCpYDc5TeTwuqFA'
        AND is_short = false
    `);
    
    const stats = statsResult.rows[0];
    console.log('Channel Statistics:');
    console.log(`  Total videos: ${stats.total_videos}`);
    console.log(`  Date range: ${stats.first_video} to ${stats.last_video}`);
    console.log(`  View range: ${parseInt(stats.min_views).toLocaleString()} to ${parseInt(stats.max_views).toLocaleString()}`);
    console.log(`  Average views: ${parseInt(stats.avg_views).toLocaleString()}\n`);
    
    // Get all videos that need updating
    const videosResult = await client.query(`
      SELECT 
        id,
        title,
        view_count,
        published_at,
        channel_baseline_at_publish,
        temporal_performance_score
      FROM videos
      WHERE channel_id = 'UCB2wtYpfbCpYDc5TeTwuqFA'
        AND is_short = false
      ORDER BY published_at
    `);
    
    const videos = videosResult.rows;
    console.log(`Processing ${videos.length} videos...\n`);
    
    let updateCount = 0;
    let skipCount = 0;
    
    // Process each video
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      
      // Get the 10 videos before this one (within 30 days)
      const priorVideos = videos
        .slice(0, i)
        .filter(v => {
          const daysDiff = (new Date(video.published_at) - new Date(v.published_at)) / (1000 * 60 * 60 * 24);
          return daysDiff <= 30 && daysDiff > 0;
        })
        .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
        .slice(0, 10);
      
      let baseline = 1.0;
      
      if (priorVideos.length > 0) {
        // Calculate average of prior videos
        const avgViews = priorVideos.reduce((sum, v) => sum + v.view_count, 0) / priorVideos.length;
        baseline = avgViews;
      }
      
      // Calculate temporal score (with cap)
      let temporalScore = video.view_count / baseline;
      if (temporalScore > 99999.999) {
        temporalScore = 99999.999;
      }
      
      // Also cap baseline to fit the column
      if (baseline > 99999.999) {
        baseline = 99999.999;
      }
      
      // Only update if values have changed significantly
      const currentBaseline = parseFloat(video.channel_baseline_at_publish);
      const currentScore = parseFloat(video.temporal_performance_score);
      
      if (Math.abs(currentBaseline - baseline) > 0.01 || Math.abs(currentScore - temporalScore) > 0.01) {
        try {
          await client.query(`
            UPDATE videos
            SET 
              channel_baseline_at_publish = $1,
              temporal_performance_score = $2,
              updated_at = NOW()
            WHERE id = $3
          `, [baseline, temporalScore, video.id]);
          
          updateCount++;
          
          if (updateCount <= 5 || updateCount % 50 === 0) {
            console.log(`[${updateCount}] Updated: ${video.title.substring(0, 50)}...`);
            console.log(`    Baseline: ${baseline.toFixed(0)} | Score: ${temporalScore.toFixed(2)} | Prior videos: ${priorVideos.length}`);
          }
        } catch (err) {
          console.error(`Failed to update ${video.id}: ${err.message}`);
          console.error(`  Attempted baseline: ${baseline}, score: ${temporalScore}`);
        }
      } else {
        skipCount++;
      }
    }
    
    console.log(`\n✅ Processing complete!`);
    console.log(`  Updated: ${updateCount} videos`);
    console.log(`  Skipped: ${skipCount} videos (already correct)`);
    
    // Show final statistics
    const finalStatsResult = await client.query(`
      SELECT 
        AVG(channel_baseline_at_publish) as avg_baseline,
        AVG(temporal_performance_score) as avg_score,
        MIN(temporal_performance_score) as min_score,
        MAX(temporal_performance_score) as max_score,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY temporal_performance_score) as median_score
      FROM videos
      WHERE channel_id = 'UCB2wtYpfbCpYDc5TeTwuqFA'
        AND is_short = false
        AND temporal_performance_score IS NOT NULL
    `);
    
    const finalStats = finalStatsResult.rows[0];
    console.log('\nFinal Channel Performance Metrics:');
    console.log(`  Average baseline: ${parseFloat(finalStats.avg_baseline).toLocaleString()}`);
    console.log(`  Average temporal score: ${parseFloat(finalStats.avg_score).toFixed(2)}`);
    console.log(`  Median temporal score: ${parseFloat(finalStats.median_score).toFixed(2)}`);
    console.log(`  Score range: ${parseFloat(finalStats.min_score).toFixed(2)} - ${parseFloat(finalStats.max_score).toFixed(2)}`);
    
  } catch (error) {
    console.error('Error updating baselines:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the fix
fixWillTennysonBaselines().catch(console.error);