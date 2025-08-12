#!/usr/bin/env node

/**
 * FAST Temporal Baseline Fix
 * Implements proper Day 30 estimation using median of previous videos
 * As documented in /docs/TEMPORAL-PERFORMANCE-SCORE-SYSTEM.md
 */

import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';

const { Pool } = pg;
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 0,
  idle_in_transaction_session_timeout: 0
});

const BATCH_SIZE = 10000; // Much larger batches
const PROGRESS_FILE = '.baseline-fast-progress.json';

// Get optional channel ID from command line for testing
const testChannelId = process.argv[2];

function saveProgress(count, lastChannel) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
    totalProcessed: count,
    lastChannelId: lastChannel,
    timestamp: new Date().toISOString()
  }, null, 2));
}

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  }
  return null;
}

/**
 * Calculate median of an array of numbers
 */
function calculateMedian(values) {
  if (values.length === 0) return 1;
  
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  } else {
    return sorted[mid];
  }
}

/**
 * Get Day 30 estimate for a video using closest snapshot or curve-based backfill
 */
function getDay30Estimate(video, snapshots, envelopes) {
  const day30Envelope = envelopes[30] || 29742;
  
  // Find snapshots for this video closest to Day 30
  const videoSnapshots = snapshots[video.id] || [];
  
  if (videoSnapshots.length > 0) {
    // Find snapshot closest to Day 30
    let closestSnapshot = null;
    let minDistance = Infinity;
    
    for (const snapshot of videoSnapshots) {
      const distance = Math.abs(snapshot.days_since_published - 30);
      if (distance < minDistance) {
        minDistance = distance;
        closestSnapshot = snapshot;
      }
    }
    
    if (closestSnapshot) {
      // Use closest snapshot with curve adjustment
      const daysAtSnapshot = closestSnapshot.days_since_published;
      const curveAtSnapshot = envelopes[Math.min(daysAtSnapshot, 365)] || day30Envelope;
      return closestSnapshot.view_count * (day30Envelope / curveAtSnapshot);
    }
  }
  
  // Fallback: use current views with curve adjustment
  const currentAge = Math.floor(video.age_days);
  const curveAtCurrent = envelopes[Math.min(currentAge, 365)] || day30Envelope;
  
  // If video is less than 30 days old, project forward
  // If video is more than 30 days old, backfill to Day 30
  return video.view_count * (day30Envelope / curveAtCurrent);
}

/**
 * Calculate temporal baseline for a video based on previous videos
 */
function calculateTemporalBaseline(currentVideo, allVideos, currentIndex, snapshots, envelopes) {
  // First video: baseline = its own Day 30 estimate
  if (currentIndex === 0) {
    return currentVideo.day30_estimate;
  }
  
  // Get all previous videos
  const previousVideos = allVideos.slice(0, currentIndex);
  
  // Calculate which videos were "mature" (>30 days old) at time of current video's publication
  const currentPubDate = new Date(currentVideo.published_at);
  const matureVideos = [];
  
  for (const prevVideo of previousVideos) {
    const prevPubDate = new Date(prevVideo.published_at);
    const daysDiff = (currentPubDate - prevPubDate) / (1000 * 60 * 60 * 24);
    
    if (daysDiff > 30) {
      matureVideos.push(prevVideo);
    }
  }
  
  // Determine which videos to use for baseline
  let videosForBaseline;
  
  if (currentIndex <= 10) {
    // Videos 2-10: use all previous videos
    videosForBaseline = previousVideos;
  } else if (matureVideos.length >= 10) {
    // Videos 11+: use last 10 mature videos
    videosForBaseline = matureVideos.slice(-10);
  } else {
    // Not enough mature videos, use last 10 available
    videosForBaseline = previousVideos.slice(-10);
  }
  
  // Get Day 30 estimates for baseline videos
  const day30Estimates = videosForBaseline.map(v => v.day30_estimate);
  
  // Calculate median
  const median = calculateMedian(day30Estimates);
  
  // Ensure baseline is at least 1 to avoid division by zero
  return Math.max(median, 1);
}

async function main() {
  console.log('🚀 FAST Temporal Baseline Fix - Using Median Day 30 Estimates');
  console.log('==============================================================\n');

  // Don't use progress when testing a specific channel
  const progress = testChannelId ? null : loadProgress();
  let totalProcessed = progress?.totalProcessed || 0;
  let lastChannelId = progress?.lastChannelId || '';

  if (progress) {
    console.log(`📂 Resuming: ${totalProcessed} videos already processed\n`);
  }
  
  if (testChannelId) {
    console.log(`🧪 TEST MODE: Processing only channel ${testChannelId}`);
    console.log('Progress tracking disabled for test mode\n');
  }

  // Get total count
  const countResult = await pool.query(`
    SELECT COUNT(*) as total FROM videos WHERE is_short = false
  `);
  const totalVideos = parseInt(countResult.rows[0].total);
  console.log(`📊 Total: ${totalVideos} videos | Remaining: ${totalVideos - totalProcessed}\n`);

  // Load performance envelopes
  console.log('Loading performance envelopes...');
  const envResult = await pool.query(`
    SELECT day_since_published, p50_views 
    FROM performance_envelopes 
    WHERE day_since_published <= 365
    ORDER BY day_since_published
  `);
  
  const envelopes = {};
  envResult.rows.forEach(r => {
    envelopes[r.day_since_published] = parseFloat(r.p50_views);
  });
  const day30P50 = envelopes[30] || 29742;
  console.log(`Day 30 P50: ${day30P50.toLocaleString()}\n`);

  // Get all channels to process
  console.log('Getting channel list...');
  let channelQuery = `
    SELECT DISTINCT channel_id 
    FROM videos 
    WHERE is_short = false
  `;
  
  // If testing a specific channel, filter to just that channel
  if (testChannelId) {
    channelQuery += ` AND channel_id = '${testChannelId}'`;
  } else if (lastChannelId) {
    channelQuery += ` AND channel_id > '${lastChannelId}'`;
  }
  
  channelQuery += ` ORDER BY channel_id`;
  
  const channelsResult = await pool.query(channelQuery);
  const channels = channelsResult.rows.map(r => r.channel_id);
  console.log(`Processing ${channels.length} channels\n`);

  const startTime = Date.now();
  let channelCount = 0;

  // Process each channel
  for (const channelId of channels) {
    channelCount++;
    
    // Get ALL videos for this channel at once
    const channelVideos = await pool.query(`
      SELECT id, published_at, view_count,
             DATE_PART('day', NOW() - published_at) as age_days
      FROM videos
      WHERE channel_id = $1 AND is_short = false
      ORDER BY published_at
    `, [channelId]);

    const videos = channelVideos.rows;
    if (videos.length === 0) continue;
    
    // Get all snapshots for this channel's videos
    const videoIds = videos.map(v => v.id);
    const snapshotResult = await pool.query(`
      SELECT video_id, view_count, days_since_published
      FROM view_snapshots
      WHERE video_id = ANY($1::text[])
      ORDER BY video_id, days_since_published
    `, [videoIds]);
    
    // Organize snapshots by video_id
    const snapshots = {};
    snapshotResult.rows.forEach(s => {
      if (!snapshots[s.video_id]) {
        snapshots[s.video_id] = [];
      }
      snapshots[s.video_id].push({
        view_count: parseFloat(s.view_count),
        days_since_published: parseInt(s.days_since_published)
      });
    });

    // First pass: Calculate Day 30 estimates for all videos
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      video.age_days = parseFloat(video.age_days);
      video.view_count = parseFloat(video.view_count);
      
      // Calculate Day 30 estimate for this video
      video.day30_estimate = getDay30Estimate(video, snapshots, envelopes);
    }
    
    const updates = [];
    
    // Second pass: Calculate baselines and scores
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      
      // Calculate temporal baseline
      const baseline = calculateTemporalBaseline(video, videos, i, snapshots, envelopes);
      
      // Calculate performance score (Day 30 estimate / baseline)
      const score = video.day30_estimate / baseline;
      
      updates.push({
        id: video.id,
        baseline: baseline,
        score: Math.min(score, 99999.999)
      });
    }

    // Batch update all videos for this channel
    if (updates.length > 0) {
      // Split into smaller chunks to avoid parameter limit
      for (let i = 0; i < updates.length; i += 500) {
        const chunk = updates.slice(i, i + 500);
        const values = chunk.map((u, idx) => 
          `($${idx*3+1}::text, $${idx*3+2}::numeric, $${idx*3+3}::numeric)`
        ).join(',');
        
        const params = chunk.flatMap(u => [u.id, u.baseline, u.score]);
        
        await pool.query(`
          UPDATE videos v
          SET channel_baseline_at_publish = u.baseline,
              temporal_performance_score = u.score
          FROM (VALUES ${values}) AS u(id, baseline, score)
          WHERE v.id = u.id::text
        `, params);
      }
    }

    totalProcessed += videos.length;
    
    // Progress update every 10 channels (skip in test mode)
    if (!testChannelId && channelCount % 10 === 0) {
      saveProgress(totalProcessed, channelId);
      
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (totalProcessed - (progress?.totalProcessed || 0)) / elapsed;
      const remaining = totalVideos - totalProcessed;
      const eta = remaining / rate;
      const pct = (totalProcessed / totalVideos * 100).toFixed(1);
      
      console.log(`[${pct}%] Channel ${channelCount}/${channels.length} | Videos: ${totalProcessed}/${totalVideos} | Rate: ${rate.toFixed(1)}/s | ETA: ${Math.round(eta/60)}m`);
    }
  }

  // Final save (skip in test mode)
  if (!testChannelId) {
    saveProgress(totalProcessed, '');
    
    // Cleanup
    if (fs.existsSync(PROGRESS_FILE)) {
      fs.unlinkSync(PROGRESS_FILE);
    }
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log('\n✅ Complete!');
  console.log(`Processed ${totalProcessed} videos in ${Math.round(totalTime/60)} minutes`);
  console.log(`Average rate: ${(totalProcessed/totalTime).toFixed(1)} videos/second`);
  
  await pool.end();
}

process.on('SIGINT', () => {
  console.log('\n\n⚠️ Interrupted - progress saved');
  process.exit(0);
});

main().catch(console.error);