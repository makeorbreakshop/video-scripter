#!/usr/bin/env node

/**
 * Simple Temporal Baseline Fix
 * Processes videos in batches without complex preloading
 */

import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';

const { Pool } = pg;
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 0,  // No timeout
  idle_in_transaction_session_timeout: 0
});

const BATCH_SIZE = 1000;
const PROGRESS_FILE = '.baseline-progress.json';

function saveProgress(lastId, count) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
    lastVideoId: lastId,
    totalProcessed: count,
    timestamp: new Date().toISOString()
  }, null, 2));
}

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  }
  return null;
}

async function main() {
  console.log('🚀 Simple Temporal Baseline Fix');
  console.log('================================\n');

  const progress = loadProgress();
  let totalProcessed = progress?.totalProcessed || 0;
  let lastVideoId = progress?.lastVideoId || '00000000-0000-0000-0000-000000000000';

  if (progress) {
    console.log(`📂 Resuming from: ${totalProcessed} videos processed\n`);
  }

  // Get total count
  const countResult = await pool.query(`
    SELECT COUNT(*) as total 
    FROM videos 
    WHERE is_short = false
  `);
  const totalVideos = parseInt(countResult.rows[0].total);
  console.log(`📊 Total videos to process: ${totalVideos - totalProcessed}\n`);

  // Load performance envelope for backfill
  console.log('Loading performance envelopes...');
  const envResult = await pool.query(`
    SELECT day_since_published, p50_views 
    FROM performance_envelopes 
    WHERE day_since_published <= 365
  `);
  
  const envelopes = {};
  envResult.rows.forEach(r => {
    envelopes[r.day_since_published] = parseFloat(r.p50_views);
  });
  const day30P50 = envelopes[30] || 29742;
  console.log(`Day 30 P50: ${day30P50}\n`);

  const startTime = Date.now();
  let batch = 0;

  while (totalProcessed < totalVideos) {
    batch++;
    
    // Get next batch
    const videos = await pool.query(`
      SELECT id, channel_id, published_at, view_count,
             DATE_PART('day', NOW() - published_at) as age_days
      FROM videos
      WHERE is_short = false
        AND id > $1
      ORDER BY id
      LIMIT $2
    `, [lastVideoId, BATCH_SIZE]);

    if (videos.rows.length === 0) break;

    const updates = [];
    
    for (const video of videos.rows) {
      // Get last 10 videos from same channel before this one
      const historyResult = await pool.query(`
        SELECT view_count, 
               DATE_PART('day', NOW() - published_at) as age_days
        FROM videos
        WHERE channel_id = $1
          AND published_at < $2
          AND is_short = false
        ORDER BY published_at DESC
        LIMIT 10
      `, [video.channel_id, video.published_at]);

      let baseline = 1.0;
      
      if (historyResult.rows.length > 0) {
        // Backfill each historical video to Day 30
        const backfilledViews = historyResult.rows.map(h => {
          const age = parseFloat(h.age_days);
          const views = parseFloat(h.view_count);
          
          if (age >= 30) {
            // Already past Day 30, use actual views
            return views;
          } else {
            // Backfill to Day 30
            const currentP50 = envelopes[Math.floor(age)] || 1;
            const multiplier = day30P50 / currentP50;
            return views * multiplier;
          }
        });

        // Calculate median
        backfilledViews.sort((a, b) => a - b);
        const mid = Math.floor(backfilledViews.length / 2);
        baseline = backfilledViews.length % 2 === 0
          ? (backfilledViews[mid - 1] + backfilledViews[mid]) / 2
          : backfilledViews[mid];
        
        baseline = Math.max(baseline, 1);
      }

      const score = video.view_count / baseline;
      
      updates.push({
        id: video.id,
        baseline: baseline,
        score: Math.min(score, 99999.999)
      });
    }

    // Batch update
    if (updates.length > 0) {
      const values = updates.map((u, i) => 
        `($${i*3+1}::text, $${i*3+2}::numeric, $${i*3+3}::numeric)`
      ).join(',');
      
      const params = updates.flatMap(u => [u.id, u.baseline, u.score]);
      
      await pool.query(`
        UPDATE videos v
        SET channel_baseline_at_publish = u.baseline,
            temporal_performance_score = u.score
        FROM (VALUES ${values}) AS u(id, baseline, score)
        WHERE v.id = u.id::text
      `, params);
    }

    totalProcessed += videos.rows.length;
    lastVideoId = videos.rows[videos.rows.length - 1].id;
    
    // Save progress
    saveProgress(lastVideoId, totalProcessed);
    
    // Stats
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = (totalProcessed - (progress?.totalProcessed || 0)) / elapsed;
    const remaining = totalVideos - totalProcessed;
    const eta = remaining / rate;
    const pct = (totalProcessed / totalVideos * 100).toFixed(1);
    
    console.log(`[${pct}%] Batch ${batch}: ${videos.rows.length} videos | Total: ${totalProcessed}/${totalVideos} | Rate: ${rate.toFixed(1)}/s | ETA: ${Math.round(eta/60)}m`);
  }

  // Cleanup
  if (fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
  }

  console.log('\n✅ Complete!');
  await pool.end();
}

process.on('SIGINT', () => {
  console.log('\n\n⚠️ Interrupted - progress saved');
  process.exit(0);
});

main().catch(console.error);