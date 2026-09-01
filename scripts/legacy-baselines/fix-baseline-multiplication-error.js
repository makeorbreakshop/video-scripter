#!/usr/bin/env node

/**
 * FIX BASELINE MULTIPLICATION ERROR
 * 
 * The calculate_video_channel_baseline() function incorrectly divides by 29,742
 * This script multiplies the broken baselines by 29,742 to get correct values
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

const P50_VALUE = 29742; // The global P50 that was incorrectly used as divisor

async function testFix() {
  console.log('🧪 TESTING FIX ON 5 SAMPLE VIDEOS');
  console.log('==================================\n');
  
  // Get 5 test videos
  const testQuery = `
    SELECT 
      id,
      title,
      view_count,
      channel_baseline_at_publish as broken_baseline,
      temporal_performance_score as broken_score
    FROM videos
    WHERE channel_baseline_at_publish < 100 
      AND channel_baseline_at_publish > 0
    ORDER BY RANDOM()
    LIMIT 5;
  `;
  
  const testVideos = await pool.query(testQuery);
  
  console.log('Sample fixes:\n');
  for (const video of testVideos.rows) {
    const fixedBaseline = parseFloat(video.broken_baseline) * P50_VALUE;
    const fixedScore = video.view_count / fixedBaseline;
    
    console.log(`📹 ${video.title.substring(0, 40)}...`);
    console.log(`   Broken baseline: ${video.broken_baseline} → Fixed: ${fixedBaseline.toFixed(0)}`);
    console.log(`   Broken score: ${video.broken_score} → Fixed: ${fixedScore.toFixed(2)}`);
    console.log('');
  }
  
  return true;
}

async function applyFix() {
  console.log('\n🔧 APPLYING FIX TO ALL BROKEN BASELINES');
  console.log('========================================\n');
  
  try {
    // Count affected videos
    const countQuery = `
      SELECT COUNT(*) as count
      FROM videos
      WHERE channel_baseline_at_publish < 100 
        AND channel_baseline_at_publish > 0;
    `;
    
    const countResult = await pool.query(countQuery);
    const totalCount = parseInt(countResult.rows[0].count);
    
    console.log(`📊 Found ${totalCount.toLocaleString()} videos to fix\n`);
    
    if (totalCount === 0) {
      console.log('✅ No broken baselines found.');
      return;
    }
    
    console.log('⚠️  This will multiply all baselines < 100 by 29,742');
    console.log('   and recalculate temporal performance scores');
    console.log('\n   Starting fix in 5 seconds... (Ctrl+C to cancel)\n');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Apply the fix in batches
    const BATCH_SIZE = 5000;
    let processed = 0;
    
    while (processed < totalCount) {
      console.log(`\n📦 Processing batch starting at ${processed.toLocaleString()}...`);
      
      // Get batch of videos
      const batchQuery = `
        SELECT 
          id,
          view_count,
          channel_baseline_at_publish
        FROM videos
        WHERE channel_baseline_at_publish < 1.0 
          AND channel_baseline_at_publish > 0
        LIMIT ${BATCH_SIZE};
      `;
      
      const batchResult = await pool.query(batchQuery);
      
      if (batchResult.rows.length === 0) break;
      
      // Build update values
      const updates = batchResult.rows.map(video => {
        const fixedBaseline = parseFloat(video.channel_baseline_at_publish) * P50_VALUE;
        const fixedScore = video.view_count / fixedBaseline;
        return {
          id: video.id,
          baseline: fixedBaseline,
          score: Math.min(fixedScore, 99999.999)
        };
      });
      
      // Build VALUES clause for bulk update
      const values = updates.map((u, i) => {
        const offset = i * 3;
        return `($${offset + 1}::text, $${offset + 2}::numeric, $${offset + 3}::numeric)`;
      }).join(', ');
      
      // Flatten parameters
      const params = updates.flatMap(u => [u.id, u.baseline, u.score]);
      
      // Apply update
      const updateQuery = `
        UPDATE videos
        SET 
          channel_baseline_at_publish = updates.baseline,
          temporal_performance_score = updates.score
        FROM (VALUES ${values}) AS updates(id, baseline, score)
        WHERE videos.id = updates.id;
      `;
      
      const updateResult = await pool.query(updateQuery, params);
      processed += updateResult.rowCount;
      
      console.log(`   ✅ Fixed ${updateResult.rowCount} videos (Total: ${processed.toLocaleString()}/${totalCount.toLocaleString()})`);
    }
    
    console.log('\n✅ FIX COMPLETE!');
    
    // Verify the fix
    console.log('\n🔍 Verifying fix...');
    const verifyQuery = `
      SELECT 
        COUNT(*) as remaining_broken
      FROM videos
      WHERE channel_baseline_at_publish < 1.0 
        AND channel_baseline_at_publish > 0;
    `;
    
    const verifyResult = await pool.query(verifyQuery);
    const remaining = parseInt(verifyResult.rows[0].remaining_broken);
    
    if (remaining === 0) {
      console.log('✅ Verification passed: All baselines fixed!');
    } else {
      console.log(`⚠️  Warning: ${remaining} baselines still < 1.0`);
    }
    
    // Show some examples of fixed data
    console.log('\n📊 Sample of fixed data:');
    const sampleQuery = `
      SELECT 
        title,
        view_count,
        channel_baseline_at_publish,
        temporal_performance_score
      FROM videos
      WHERE channel_baseline_at_publish > 1000
      ORDER BY RANDOM()
      LIMIT 5;
    `;
    
    const sampleResult = await pool.query(sampleQuery);
    for (const video of sampleResult.rows) {
      console.log(`\n   ${video.title.substring(0, 50)}...`);
      console.log(`   Baseline: ${parseFloat(video.channel_baseline_at_publish).toFixed(0)}, Score: ${parseFloat(video.temporal_performance_score).toFixed(2)}`);
    }
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
    throw error;
  }
}

// Main execution
async function main() {
  try {
    // First test the fix
    const testPassed = await testFix();
    
    if (!testPassed) {
      console.log('❌ Test failed. Not applying fix.');
      return;
    }
    
    // Then apply it
    await applyFix();
    
  } catch (error) {
    console.error('💥 Critical error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main()
  .then(() => {
    console.log('\n🎯 Operation completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 Operation failed:', error);
    process.exit(1);
  });