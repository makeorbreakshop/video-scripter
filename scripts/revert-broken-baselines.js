#!/usr/bin/env node

/**
 * EMERGENCY: Revert Broken Temporal Baselines
 * 
 * Reverts all videos with incorrect baselines (< 1.0) back to NULL
 * These were caused by broken calculate_video_channel_baseline() function
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

async function revertBrokenBaselines() {
  console.log('🚨 EMERGENCY REVERT: Broken Temporal Baselines');
  console.log('=============================================');
  
  try {
    // Count broken records first
    const countQuery = `
      SELECT COUNT(*) as broken_count
      FROM videos 
      WHERE channel_baseline_at_publish < 1.0 
        AND channel_baseline_at_publish > 0;
    `;
    
    const countResult = await pool.query(countQuery);
    const brokenCount = parseInt(countResult.rows[0].broken_count);
    
    console.log(`\n❌ Found ${brokenCount.toLocaleString()} videos with broken baselines (< 1.0)`);
    
    if (brokenCount === 0) {
      console.log('✅ No broken baselines found. Nothing to revert.');
      return;
    }
    
    console.log('\n⚠️  WARNING: This will revert all broken baselines to NULL');
    console.log('   Affected videos will need proper baseline calculation later');
    console.log('\n   Starting revert in 3 seconds... (Ctrl+C to cancel)');
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Revert the broken baselines
    console.log('\n🔄 Reverting broken baselines...');
    const revertQuery = `
      UPDATE videos 
      SET 
        channel_baseline_at_publish = NULL,
        temporal_performance_score = NULL
      WHERE channel_baseline_at_publish < 1.0 
        AND channel_baseline_at_publish > 0;
    `;
    
    const startTime = Date.now();
    const revertResult = await pool.query(revertQuery);
    const endTime = Date.now();
    
    console.log(`\n✅ REVERT COMPLETE!`);
    console.log(`   - Reverted ${revertResult.rowCount.toLocaleString()} video baselines`);
    console.log(`   - Time taken: ${((endTime - startTime) / 1000).toFixed(1)} seconds`);
    
    // Verify the revert worked
    const verifyResult = await pool.query(countQuery);
    const remainingBroken = parseInt(verifyResult.rows[0].broken_count);
    
    if (remainingBroken === 0) {
      console.log('✅ Verification passed: No broken baselines remaining');
    } else {
      console.log(`⚠️  Warning: ${remainingBroken} broken baselines still remain`);
    }
    
  } catch (error) {
    console.error('❌ REVERT FAILED:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the revert
revertBrokenBaselines()
  .then(() => {
    console.log('\n🎯 Revert operation completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 CRITICAL ERROR:', error);
    process.exit(1);
  });