#!/usr/bin/env node

/**
 * Fix Temporal Baselines using Direct Database Connection
 * 
 * This script bypasses Supabase API timeouts by using direct PostgreSQL connection.
 * Based on the successful Python approach from August 7th that processed 142 videos/sec.
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
const BATCH_SIZE = 100; // Process in batches for progress tracking
const CALCULATE_BATCH_SIZE = 10; // How many baselines to calculate at once

async function getVideosNeedingFix() {
  console.log('🔍 Finding videos that need baseline fixes...');
  
  // Simpler query - just get videos with baseline = 1.0 that aren't first videos
  // We'll determine if they're first videos in JavaScript
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
    ORDER BY v.channel_id, v.published_at
    LIMIT 10000;  -- Process in chunks to avoid timeout
  `;
  
  const result = await pool.query(query);
  
  // Mark first videos
  const videosByChannel = {};
  for (const video of result.rows) {
    if (!videosByChannel[video.channel_id]) {
      videosByChannel[video.channel_id] = [];
    }
    videosByChannel[video.channel_id].push(video);
  }
  
  // Mark first videos for each channel
  for (const channelId in videosByChannel) {
    const channelVideos = videosByChannel[channelId];
    channelVideos.sort((a, b) => new Date(a.published_at) - new Date(b.published_at));
    if (channelVideos.length > 0) {
      channelVideos[0].is_first_video = true;
    }
    for (let i = 1; i < channelVideos.length; i++) {
      channelVideos[i].is_first_video = false;
    }
  }
  
  return result.rows;
}

async function calculateBaselinesInBatch(videos) {
  // For first videos, just return 1.0
  const results = [];
  
  for (const video of videos) {
    if (video.is_first_video) {
      results.push({
        id: video.id,
        baseline: 1.0,
        score: 1.0
      });
    } else {
      // Calculate baseline using the function
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
    }
  }
  
  return results;
}

async function updateVideosInBatch(updates) {
  // Build a single UPDATE statement for all videos in the batch
  if (updates.length === 0) return 0;
  
  // Create the VALUES clause for the update
  const values = updates.map((u, i) => {
    const offset = i * 3;
    return `($${offset + 1}::text, $${offset + 2}::numeric, $${offset + 3}::numeric)`;
  }).join(', ');
  
  // Flatten the parameters
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

async function processInBatches(videos) {
  console.log(`\n📊 Processing ${videos.length} videos in batches of ${BATCH_SIZE}...`);
  
  let totalProcessed = 0;
  let totalTime = 0;
  
  // Process in chunks
  for (let i = 0; i < videos.length; i += BATCH_SIZE) {
    const batch = videos.slice(i, i + BATCH_SIZE);
    const startTime = Date.now();
    
    // Calculate baselines for this batch
    const calculations = await calculateBaselinesInBatch(batch);
    
    // Update the database
    const updated = await updateVideosInBatch(calculations);
    
    const elapsed = (Date.now() - startTime) / 1000;
    totalTime += elapsed;
    totalProcessed += updated;
    
    const rate = updated / elapsed;
    const progress = ((i + batch.length) / videos.length * 100).toFixed(1);
    const eta = ((videos.length - totalProcessed) / rate / 60).toFixed(1);
    
    console.log(`  [${progress}%] Processed ${totalProcessed}/${videos.length} videos | Rate: ${rate.toFixed(1)} videos/sec | ETA: ${eta} minutes`);
    
    // Small delay to prevent overwhelming the database
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return { totalProcessed, totalTime };
}

async function main() {
  console.log('🚀 Temporal Baseline Fix - Direct Database Version');
  console.log('================================================\n');
  
  try {
    // Get videos needing fixes
    const videos = await getVideosNeedingFix();
    
    // Separate first videos from others for reporting
    const firstVideos = videos.filter(v => v.is_first_video);
    const otherVideos = videos.filter(v => !v.is_first_video);
    
    console.log(`Found ${videos.length} videos needing fixes:`);
    console.log(`  - ${firstVideos.length} first videos (will set to 1.0)`);
    console.log(`  - ${otherVideos.length} non-first videos (need calculation)`);
    
    if (videos.length === 0) {
      console.log('\n✅ No videos need fixing!');
      process.exit(0);
    }
    
    // Process in batches
    const startTime = Date.now();
    const { totalProcessed, totalTime } = await processInBatches(videos);
    
    // Final stats
    console.log('\n' + '='.repeat(50));
    console.log('✅ COMPLETED!');
    console.log(`  Total videos processed: ${totalProcessed}`);
    console.log(`  Total time: ${totalTime.toFixed(1)} seconds`);
    console.log(`  Average rate: ${(totalProcessed / totalTime).toFixed(1)} videos/second`);
    console.log(`  Total duration: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
main().catch(console.error);