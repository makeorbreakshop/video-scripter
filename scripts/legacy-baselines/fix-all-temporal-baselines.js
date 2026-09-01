#!/usr/bin/env node

/**
 * Fix ALL Temporal Baselines using Direct Database Connection
 * 
 * This script processes ALL videos that need baseline fixes.
 * Based on testing, processes at ~26 videos/second.
 */

import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;
dotenv.config();

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Configuration
const BATCH_SIZE = 250; // Larger batches for better performance
const QUERY_BATCH_SIZE = 50000; // How many videos to fetch at once

async function getAllVideosNeedingFix() {
  console.log('🔍 Finding ALL videos that need baseline fixes...');
  
  // Get ALL videos with baseline = 1.0 or NULL
  const query = `
    SELECT 
      v.id,
      v.channel_id,
      v.published_at,
      v.view_count,
      v.channel_baseline_at_publish,
      v.temporal_performance_score
    FROM videos v
    WHERE v.is_short = false
    AND (v.channel_baseline_at_publish = 1.0 OR v.channel_baseline_at_publish IS NULL)
    ORDER BY v.channel_id, v.published_at;
  `;
  
  console.log('  Executing query (this may take a moment)...');
  const result = await pool.query(query);
  
  // Mark first videos in JavaScript (much faster than complex SQL)
  const videosByChannel = {};
  for (const video of result.rows) {
    if (!videosByChannel[video.channel_id]) {
      videosByChannel[video.channel_id] = [];
    }
    videosByChannel[video.channel_id].push(video);
  }
  
  // Mark first videos for each channel
  let firstVideoCount = 0;
  for (const channelId in videosByChannel) {
    const channelVideos = videosByChannel[channelId];
    channelVideos.sort((a, b) => new Date(a.published_at) - new Date(b.published_at));
    if (channelVideos.length > 0) {
      channelVideos[0].is_first_video = true;
      firstVideoCount++;
    }
    for (let i = 1; i < channelVideos.length; i++) {
      channelVideos[i].is_first_video = false;
    }
  }
  
  console.log(`  Found ${result.rows.length} total videos`);
  console.log(`  - ${firstVideoCount} are first videos (will set to 1.0)`);
  console.log(`  - ${result.rows.length - firstVideoCount} need baseline calculation`);
  
  return result.rows;
}

async function calculateBaselinesInBatch(videos) {
  const results = [];
  
  for (const video of videos) {
    if (video.is_first_video) {
      // First videos always get baseline = 1.0
      results.push({
        id: video.id,
        baseline: 1.0,
        score: 1.0
      });
    } else {
      // Calculate baseline using the database function
      try {
        const baselineQuery = `SELECT calculate_video_channel_baseline($1) as baseline`;
        const baselineResult = await pool.query(baselineQuery, [video.id]);
        const baseline = parseFloat(baselineResult.rows[0].baseline);
        
        const score = baseline > 0 
          ? Math.min(parseFloat(video.view_count) / baseline, 99999.999)
          : null;
        
        results.push({
          id: video.id,
          baseline: baseline,
          score: score
        });
      } catch (error) {
        console.error(`  ⚠️ Error calculating baseline for ${video.id}:`, error.message);
        // Skip this video
      }
    }
  }
  
  return results;
}

async function updateVideosInBatch(updates) {
  if (updates.length === 0) return 0;
  
  // Build VALUES clause for bulk update
  const values = updates.map((u, i) => {
    const offset = i * 3;
    return `($${offset + 1}::text, $${offset + 2}::numeric, $${offset + 3}::numeric)`;
  }).join(', ');
  
  // Flatten parameters
  const params = updates.flatMap(u => [u.id, u.baseline, u.score]);
  
  const query = `
    UPDATE videos
    SET 
      channel_baseline_at_publish = updates.baseline,
      temporal_performance_score = updates.score
    FROM (VALUES ${values}) AS updates(id, baseline, score)
    WHERE videos.id = updates.id;
  `;
  
  const result = await pool.query(query, params);
  return result.rowCount;
}

async function processAllVideos(videos) {
  console.log(`\n📊 Processing ${videos.length} videos in batches of ${BATCH_SIZE}...`);
  console.log('  This will take approximately', Math.ceil(videos.length / 26 / 60), 'minutes\n');
  
  let totalProcessed = 0;
  const startTime = Date.now();
  
  // Process in chunks
  for (let i = 0; i < videos.length; i += BATCH_SIZE) {
    const batch = videos.slice(i, i + BATCH_SIZE);
    const batchStartTime = Date.now();
    
    // Calculate baselines
    const calculations = await calculateBaselinesInBatch(batch);
    
    // Update database
    const updated = await updateVideosInBatch(calculations);
    
    const batchTime = (Date.now() - batchStartTime) / 1000;
    totalProcessed += updated;
    
    // Progress reporting
    const overallTime = (Date.now() - startTime) / 1000;
    const rate = totalProcessed / overallTime;
    const progress = ((i + batch.length) / videos.length * 100).toFixed(1);
    const remaining = videos.length - totalProcessed;
    const eta = remaining / rate;
    
    // Format ETA
    const etaMinutes = Math.floor(eta / 60);
    const etaSeconds = Math.floor(eta % 60);
    const etaString = etaMinutes > 0 ? `${etaMinutes}m ${etaSeconds}s` : `${etaSeconds}s`;
    
    console.log(`  [${progress}%] Processed ${totalProcessed}/${videos.length} | Rate: ${rate.toFixed(1)}/sec | ETA: ${etaString} | Batch: ${batchTime.toFixed(1)}s`);
    
    // Small delay between batches to prevent overwhelming the database
    if (i + BATCH_SIZE < videos.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  
  return { totalProcessed, totalTime: (Date.now() - startTime) / 1000 };
}

async function verifyFix() {
  console.log('\n🔍 Verifying fix...');
  
  const query = `
    SELECT 
      COUNT(*) FILTER (WHERE is_short = false AND channel_baseline_at_publish = 1.0) as still_default,
      COUNT(*) FILTER (WHERE is_short = false AND channel_baseline_at_publish IS NULL) as still_null,
      COUNT(*) FILTER (WHERE is_short = false AND temporal_performance_score IS NULL) as no_score
    FROM videos;
  `;
  
  const result = await pool.query(query);
  const stats = result.rows[0];
  
  console.log('  Videos still with baseline = 1.0:', stats.still_default);
  console.log('  Videos still with baseline = NULL:', stats.still_null);
  console.log('  Videos still with score = NULL:', stats.no_score);
  
  return stats;
}

async function main() {
  console.log('🚀 Full Temporal Baseline Fix - Direct Database Version');
  console.log('====================================================\n');
  
  try {
    // Get ALL videos needing fixes
    const videos = await getAllVideosNeedingFix();
    
    if (videos.length === 0) {
      console.log('\n✅ No videos need fixing!');
      process.exit(0);
    }
    
    // Confirm before processing
    console.log('\n⚠️  WARNING: This will update', videos.length, 'videos');
    console.log('  Estimated time:', Math.ceil(videos.length / 26 / 60), 'minutes');
    console.log('  Starting in 3 seconds... (Ctrl+C to cancel)\n');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Process all videos
    const { totalProcessed, totalTime } = await processAllVideos(videos);
    
    // Verify the fix
    const verification = await verifyFix();
    
    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ COMPLETED!');
    console.log(`  Total videos processed: ${totalProcessed}`);
    console.log(`  Total time: ${(totalTime / 60).toFixed(1)} minutes`);
    console.log(`  Average rate: ${(totalProcessed / totalTime).toFixed(1)} videos/second`);
    
    if (verification.still_default > 0 || verification.still_null > 0) {
      console.log('\n⚠️  Some videos may still need attention:');
      console.log(`  - ${verification.still_default} videos still have baseline = 1.0`);
      console.log(`  - ${verification.still_null} videos still have baseline = NULL`);
      console.log('  These may be first videos or have other issues.');
    } else {
      console.log('\n🎉 All baselines successfully fixed!');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run
main().catch(console.error);