#!/usr/bin/env node

/**
 * Fix First Video Baselines
 * For videos that are the first from their channel, the baseline should be
 * their OWN Day 30 views (backfilled if needed), and performance score = 1.0
 */

import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 0
});

async function main() {
  console.log('🔧 Fixing First Video Baselines');
  console.log('================================\n');

  // Get performance envelopes for backfill
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
  console.log(`Day 30 P50: ${day30P50.toLocaleString()}\n`);

  // Find all first videos (those with baseline = 1.0)
  console.log('Finding first videos with baseline = 1.0...');
  const firstVideos = await pool.query(`
    SELECT 
      v.id,
      v.channel_id,
      v.view_count,
      v.published_at,
      DATE_PART('day', NOW() - v.published_at) as age_days
    FROM videos v
    WHERE v.channel_baseline_at_publish = 1.0
      AND v.is_short = false
      AND NOT EXISTS (
        SELECT 1 FROM videos v2 
        WHERE v2.channel_id = v.channel_id 
          AND v2.published_at < v.published_at
          AND v2.is_short = false
      )
  `);

  console.log(`Found ${firstVideos.rows.length} first videos to fix\n`);

  const updates = [];
  
  for (const video of firstVideos.rows) {
    const age = parseFloat(video.age_days);
    const currentViews = parseFloat(video.view_count);
    
    let day30Views;
    
    if (age >= 30) {
      // Video is already past Day 30, use actual views
      day30Views = currentViews;
    } else {
      // Backfill to Day 30
      const currentP50 = envelopes[Math.floor(age)] || 1;
      day30Views = currentViews * (day30P50 / currentP50);
    }
    
    updates.push({
      id: video.id,
      baseline: day30Views,
      score: 1.0  // First video always has performance = 1.0 (it IS the baseline)
    });
  }

  // Update in batches
  console.log('Updating baselines...');
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
    
    console.log(`Updated ${Math.min(i + 500, updates.length)} / ${updates.length} videos`);
  }

  // Verify the fix
  console.log('\n✅ Verifying fix...');
  const verification = await pool.query(`
    SELECT 
      COUNT(*) as fixed_count,
      AVG(channel_baseline_at_publish) as avg_baseline,
      MIN(channel_baseline_at_publish) as min_baseline,
      MAX(channel_baseline_at_publish) as max_baseline
    FROM videos 
    WHERE temporal_performance_score = 1.0 
      AND is_short = false
  `);

  console.log(`Fixed ${verification.rows[0].fixed_count} first videos`);
  console.log(`Average baseline: ${parseFloat(verification.rows[0].avg_baseline).toLocaleString()}`);
  console.log(`Min baseline: ${parseFloat(verification.rows[0].min_baseline).toLocaleString()}`);
  console.log(`Max baseline: ${parseFloat(verification.rows[0].max_baseline).toLocaleString()}`);
  
  await pool.end();
  console.log('\n✅ Complete!');
}

main().catch(console.error);