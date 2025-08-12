#!/usr/bin/env node

/**
 * TEST BASELINE CALCULATION LOGIC
 * 
 * Tests both the broken and corrected baseline calculations
 * WITHOUT modifying any data
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

async function testBaselines() {
  console.log('🧪 TESTING BASELINE CALCULATIONS');
  console.log('=================================\n');
  
  try {
    // Pick 5 test videos with broken baselines
    const testVideosQuery = `
      SELECT 
        v.id,
        v.title,
        v.channel_id,
        v.view_count,
        v.published_at,
        v.channel_baseline_at_publish as broken_baseline,
        v.temporal_performance_score as broken_score
      FROM videos v
      WHERE v.channel_baseline_at_publish < 1.0 
        AND v.channel_baseline_at_publish > 0
      ORDER BY RANDOM()
      LIMIT 5;
    `;
    
    const testVideos = await pool.query(testVideosQuery);
    
    console.log('Testing 5 sample videos:\n');
    
    for (const video of testVideos.rows) {
      console.log(`\n📹 Video: ${video.title.substring(0, 50)}...`);
      console.log(`   ID: ${video.id}`);
      console.log(`   Views: ${video.view_count.toLocaleString()}`);
      console.log(`   Current (BROKEN) baseline: ${video.broken_baseline}`);
      console.log(`   Current (BROKEN) score: ${video.broken_score}`);
      
      // Test the broken function
      const brokenResult = await pool.query(
        'SELECT calculate_video_channel_baseline($1) as baseline',
        [video.id]
      );
      console.log(`   Broken function returns: ${brokenResult.rows[0].baseline}`);
      
      // Now calculate what it SHOULD be (without the division)
      const correctQuery = `
        WITH previous_videos AS (
          SELECT
            v.id,
            v.view_count,
            GREATEST(1, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER) as current_age
          FROM videos v
          WHERE v.channel_id = $1
            AND v.published_at < $2
            AND v.view_count > 0
            AND v.is_short = false
          ORDER BY v.published_at DESC
          LIMIT 10
        ),
        estimated_day30 AS (
          SELECT
            pv.id,
            CASE
              WHEN pv.current_age <= 30 THEN pv.view_count
              ELSE pv.view_count * (pe30.p50_views::FLOAT / NULLIF(pe_current.p50_views, 1))
            END as estimated_day30_views
          FROM previous_videos pv
          LEFT JOIN performance_envelopes pe30 ON pe30.day_since_published = 30
          LEFT JOIN performance_envelopes pe_current ON pe_current.day_since_published = LEAST(pv.current_age, 3650)
        )
        SELECT
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY estimated_day30_views) as median_day30,
          COUNT(*) as video_count
        FROM estimated_day30;
      `;
      
      const correctResult = await pool.query(correctQuery, [video.channel_id, video.published_at]);
      const correctBaseline = correctResult.rows[0].median_day30 || 1.0;
      const videoCount = correctResult.rows[0].video_count;
      
      console.log(`\n   ✅ CORRECT baseline should be: ${Math.round(correctBaseline).toLocaleString()}`);
      console.log(`      (Based on ${videoCount} previous videos)`);
      console.log(`   ✅ CORRECT score would be: ${(video.view_count / correctBaseline).toFixed(2)}`);
      
      // Show the multiplication factor error
      const errorFactor = correctBaseline / parseFloat(video.broken_baseline);
      console.log(`\n   ❌ ERROR FACTOR: ${errorFactor.toFixed(0)}x too small!`);
      console.log(`      The broken function divided by ~29,742 when it shouldn't have`);
    }
    
    // Check the global P50 that's causing the problem
    const p50Query = `SELECT p50_views FROM performance_envelopes WHERE day_since_published = 30`;
    const p50Result = await pool.query(p50Query);
    console.log(`\n\n🔍 Global P50 at day 30: ${p50Result.rows[0].p50_views.toLocaleString()}`);
    console.log('   This is what the broken function is incorrectly dividing by!');
    
    // Count how many videos are affected
    const countQuery = `
      SELECT 
        COUNT(*) as total_broken,
        COUNT(DISTINCT channel_id) as channels_affected
      FROM videos 
      WHERE channel_baseline_at_publish < 1.0 
        AND channel_baseline_at_publish > 0;
    `;
    
    const countResult = await pool.query(countQuery);
    console.log(`\n\n📊 IMPACT ASSESSMENT:`);
    console.log(`   - ${countResult.rows[0].total_broken.toLocaleString()} videos have broken baselines`);
    console.log(`   - ${countResult.rows[0].channels_affected.toLocaleString()} channels affected`);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the test
testBaselines()
  .then(() => {
    console.log('\n\n✅ Test complete - NO DATA WAS MODIFIED');
    console.log('\nNEXT STEPS:');
    console.log('1. Create a CORRECTED baseline calculation function');
    console.log('2. Test it on a small sample first');
    console.log('3. Only then apply to all affected videos');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 Test error:', error);
    process.exit(1);
  });