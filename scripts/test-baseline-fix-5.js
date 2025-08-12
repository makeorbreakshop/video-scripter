#!/usr/bin/env node

import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const P50_VALUE = 29742;

async function fixFive() {
  console.log('Finding 5 broken baselines...');
  
  // Get 5 broken videos
  const result = await pool.query(`
    SELECT id, title, view_count, channel_baseline_at_publish, temporal_performance_score
    FROM videos
    WHERE channel_baseline_at_publish < 100 
      AND channel_baseline_at_publish > 0
      AND is_short = false
    LIMIT 5;
  `);
  
  console.log('\nBEFORE FIX:');
  result.rows.forEach(video => {
    console.log(`${video.title.substring(0, 50)}...`);
    console.log(`  Baseline: ${video.channel_baseline_at_publish}, Score: ${video.temporal_performance_score}`);
  });
  
  // Fix them
  const updates = result.rows.map(video => {
    const fixedBaseline = parseFloat(video.channel_baseline_at_publish) * P50_VALUE;
    const fixedScore = video.view_count / fixedBaseline;
    return {
      id: video.id,
      baseline: fixedBaseline,
      score: Math.min(fixedScore, 99999.999)
    };
  });
  
  // Build VALUES clause
  const values = updates.map((u, i) => {
    const offset = i * 3;
    return `($${offset + 1}::text, $${offset + 2}::numeric, $${offset + 3}::numeric)`;
  }).join(', ');
  
  const params = updates.flatMap(u => [u.id, u.baseline, u.score]);
  
  await pool.query(`
    UPDATE videos
    SET 
      channel_baseline_at_publish = updates.baseline,
      temporal_performance_score = updates.score
    FROM (VALUES ${values}) AS updates(id, baseline, score)
    WHERE videos.id = updates.id;
  `, params);
  
  console.log('\nFIXED! Checking results...');
  
  // Check results
  const checkResult = await pool.query(`
    SELECT id, title, view_count, channel_baseline_at_publish, temporal_performance_score
    FROM videos
    WHERE id = ANY($1);
  `, [updates.map(u => u.id)]);
  
  console.log('\nAFTER FIX:');
  checkResult.rows.forEach(video => {
    console.log(`${video.title.substring(0, 50)}...`);
    console.log(`  Baseline: ${video.channel_baseline_at_publish}, Score: ${video.temporal_performance_score}`);
  });
  
  await pool.end();
}

fixFive().catch(console.error);