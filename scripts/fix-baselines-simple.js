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

async function fixAllBaselines() {
  console.log('🔧 FIXING ALL BROKEN BASELINES');
  console.log('===============================\n');
  
  try {
    let totalFixed = 0;
    let batchNumber = 1;
    
    while (true) {
      console.log(`📦 Processing batch ${batchNumber}...`);
      
      // Get broken videos
      const selectQuery = `
        SELECT id, view_count, channel_baseline_at_publish
        FROM videos
        WHERE channel_baseline_at_publish < 100 
          AND channel_baseline_at_publish > 0
          AND is_short = false
        LIMIT 1000;
      `;
      
      const result = await pool.query(selectQuery);
      
      if (result.rows.length === 0) {
        console.log('✅ No more broken baselines found!');
        break;
      }
      
      console.log(`   Found ${result.rows.length} broken videos`);
      
      // Build updates
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
      
      // Update
      const updateQuery = `
        UPDATE videos
        SET 
          channel_baseline_at_publish = updates.baseline,
          temporal_performance_score = updates.score
        FROM (VALUES ${values}) AS updates(id, baseline, score)
        WHERE videos.id = updates.id;
      `;
      
      const updateResult = await pool.query(updateQuery, params);
      
      console.log(`   ✅ Fixed ${updateResult.rowCount} videos`);
      totalFixed += updateResult.rowCount;
      
      batchNumber++;
      
      // Small delay
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n🎯 COMPLETE! Fixed ${totalFixed.toLocaleString()} total videos`);
    
    // Final verification
    const verifyResult = await pool.query(`
      SELECT COUNT(*) as still_broken
      FROM videos
      WHERE channel_baseline_at_publish < 100 
        AND channel_baseline_at_publish > 0
        AND is_short = false;
    `);
    
    const stillBroken = parseInt(verifyResult.rows[0].still_broken);
    
    if (stillBroken === 0) {
      console.log('✅ Verification: All baselines are now fixed!');
    } else {
      console.log(`⚠️  Warning: ${stillBroken.toLocaleString()} videos still have broken baselines`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

fixAllBaselines()
  .then(() => {
    console.log('\n🎯 Operation completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 Operation failed:', error);
    process.exit(1);
  });